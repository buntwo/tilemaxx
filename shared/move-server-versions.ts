import {
  BOARD_EDIT_LABELS,
  type ArchiveState,
  type Game,
  type HistoryEntry,
} from "./model";

type RecordedAt = { at: string; serverVersion?: string };
type History = Pick<ArchiveState, "past" | "future" | "trackedMoves">;
const boardEdits = new Set<string>(Object.values(BOARD_EDIT_LABELS));

// Board entries can become opponent moves when score history is recovered.
const canRecordMove = (entry: HistoryEntry) =>
  entry.score !== undefined || boardEdits.has(entry.label);

export function moveServerVersions(game: Game) {
  const versions = new Map<string, string | undefined>();
  function add({ at, serverVersion }: RecordedAt) {
    // Keep unknown timestamps so a recovery or correction cannot relabel old moves.
    if (serverVersion !== undefined || !versions.has(at))
      versions.set(at, serverVersion);
  }
  for (const history of [game, game.archivedState]) {
    if (!history) continue;
    for (const entry of [...history.past, ...history.future]) {
      add(canRecordMove(entry) ? entry : { at: entry.at });
      entry.trackedMoves?.forEach(add);
    }
    history.trackedMoves?.forEach(add);
  }
  return versions;
}

export function mapMoveServerVersions(
  game: Game,
  versionFor: (entry: RecordedAt) => string | undefined,
): Game {
  function withVersion<T extends RecordedAt>(
    entry: T,
    serverVersion: string | undefined,
  ): T {
    if (entry.serverVersion === serverVersion) return entry;
    const next = { ...entry };
    if (serverVersion === undefined) delete next.serverVersion;
    else next.serverVersion = serverVersion;
    return next;
  }
  function stamp<T extends RecordedAt>(entry: T): T {
    return withVersion(entry, versionFor(entry));
  }
  function mapChanged<T>(items: T[], update: (item: T) => T): T[] {
    const next = items.map(update);
    return next.some((item, i) => item !== items[i]) ? next : items;
  }
  function stampEntry(entry: HistoryEntry): HistoryEntry {
    const next = canRecordMove(entry)
      ? stamp(entry)
      : withVersion(entry, undefined);
    const trackedMoves =
      entry.trackedMoves && mapChanged(entry.trackedMoves, stamp);
    return trackedMoves === entry.trackedMoves
      ? next
      : { ...next, trackedMoves };
  }
  function stampHistory<T extends History>(history: T): T {
    const past = mapChanged(history.past, stampEntry);
    const future = mapChanged(history.future, stampEntry);
    const trackedMoves =
      history.trackedMoves && mapChanged(history.trackedMoves, stamp);
    return past === history.past &&
      future === history.future &&
      trackedMoves === history.trackedMoves
      ? history
      : { ...history, past, future, trackedMoves };
  }
  const current = stampHistory(game);
  const archivedState = game.archivedState && stampHistory(game.archivedState);
  return archivedState === game.archivedState
    ? current
    : { ...current, archivedState };
}

export function carrySavedMoveVersions(draft: Game, saved: Game): Game {
  const versions = moveServerVersions(saved);
  return mapMoveServerVersions(draft, (entry) =>
    versions.has(entry.at) ? versions.get(entry.at) : entry.serverVersion,
  );
}

import { useEffect, useMemo, useState } from "react";
import { HardDriveDownload, LoaderCircle, TriangleAlert } from "lucide-react";
import type { GameSummary } from "../../shared/game-index";
import type { Game } from "../../shared/model";
import { prepareOfflineApp } from "../offline";
import { offlineGamePlan, prepareOfflineGames } from "../offline-games";
import { store } from "../store";
import { dictionaryUrl, loadWordList } from "../word-list-cache";

export default function OfflineStatus({
  game,
  games,
  openGameId,
  online,
  storageError = false,
}: {
  game?: Game;
  games?: readonly GameSummary[];
  openGameId?: string;
  online: boolean;
  storageError?: boolean;
}) {
  const dictionaryId = game?.archived ? undefined : game?.dictionaryId;
  const plan = useMemo(
    () => games && JSON.stringify(offlineGamePlan(games, openGameId)),
    [games, openGameId],
  );
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState({ key: "", busy: true, message: "" });
  const [library, setLibrary] =
    useState<Awaited<ReturnType<typeof prepareOfflineGames>>>();
  useEffect(() => {
    if (plan === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    const candidates: ReturnType<typeof offlineGamePlan> = JSON.parse(plan);
    const prepare = async () => {
      if (online) await prepareOfflineApp();
      signal.throwIfAborted();
      return prepareOfflineGames(
        candidates,
        online ? store.getGameForOffline : undefined,
        signal,
      );
    };
    void prepare().then(
      (result) => {
        if (!signal.aborted) setLibrary(result);
      },
      (error: unknown) => {
        if (!signal.aborted)
          setLibrary({
            ready: 0,
            total: candidates.length,
            message:
              error instanceof Error
                ? error.message
                : "Could not prepare games for offline use.",
          });
      },
    );
    return () => controller.abort();
  }, [plan, online, retry]);
  useEffect(() => {
    if (!dictionaryId) return;
    let cancelled = false;
    setStatus({ key: dictionaryId, busy: true, message: "" });
    const words = async () => {
      const result = await loadWordList(dictionaryUrl(dictionaryId), {
        refresh: online,
      });
      if (!result.persisted)
        throw new Error(
          "Word lists could not be stored on this device. Free some browser storage and retry.",
        );
    };
    void Promise.allSettled([words(), prepareOfflineApp()]).then((results) => {
      if (cancelled) return;
      const failed = results.find((result) => result.status === "rejected");
      setStatus({
        key: dictionaryId,
        busy: false,
        message:
          failed?.status === "rejected"
            ? failed.reason instanceof Error
              ? failed.reason.message
              : "Offline preparation failed. Reconnect and retry."
            : "",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [dictionaryId, online, retry]);
  if (!dictionaryId && !library?.total) return null;
  const busy =
    (!!dictionaryId && (status.key !== dictionaryId || status.busy)) ||
    (plan !== undefined && !library);
  const currentMessage = dictionaryId ? status.message : "";
  const message = storageError
    ? "This game could not be saved on this device. Keep this page open and restore browser storage before going offline."
    : currentMessage || library?.message;
  const label =
    library && (library.total > 1 || library.ready < library.total)
      ? library.ready === library.total
        ? `${library.ready} games available offline`
        : `${library.ready} of ${library.total} games available offline`
      : "Available offline";
  if (busy || !message)
    return (
      <span className="offline-status offline-status-label">
        {busy ? (
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
        ) : (
          <HardDriveDownload size={15} aria-hidden="true" />
        )}
        <span>{busy ? "Preparing offline…" : label}</span>
      </span>
    );
  return (
    <details className="offline-status">
      <summary className="offline-status-label">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>
          {!storageError && !currentMessage && library?.ready
            ? label
            : "Offline unavailable"}
        </span>
      </summary>
      <div>
        <p>{message}</p>
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Retry offline setup
        </button>
      </div>
    </details>
  );
}

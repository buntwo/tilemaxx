import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gameReplayTimeline, hasRecordedMoves, replayGamePosition } from "../shared/game-replay";
import type { Game } from "../shared/model";

const STEP_MS = 1100;
type Timeline = ReturnType<typeof gameReplayTimeline>;

type Session = {
  source: Game;
  timeline: Timeline;
  index: number;
  playing: boolean;
  showRecorded: boolean;
  trial?: Game;
  returnFocus: HTMLElement | null;
};

export function useGameReplay(game: Game | undefined, shortcutsEnabled: boolean) {
  const [session, setSession] = useState<Session>();
  const focusAfterClose = useRef<HTMLElement | null>(null);
  const available = useMemo(() => !!game && hasRecordedMoves(game), [game]);
  const archive = useMemo<Session | undefined>(() => {
    if (!game?.archived || !available) return;
    const timeline = gameReplayTimeline(game);
    return { source: game, timeline, index: timeline.frames.length, playing: false, showRecorded: false, returnFocus: null };
  }, [game, available]);
  const current = session?.source.id === game?.id && session?.source.archived === game?.archived
    ? session ?? archive
    : archive;
  const timeline = current?.timeline;
  const recordedCount = timeline ? timeline.frames.length - 1 : 0;
  const last = recordedCount + (game?.archived ? 1 : 0);
  const index = current?.index ?? 0;
  const historical = !!current && index <= recordedCount;
  const frame = timeline?.frames[Math.min(index, recordedCount)];
  const trial = historical ? current?.trial : undefined;
  const playing = !!current?.playing;
  const setup = useMemo(() => {
    if (!historical || !frame || !timeline || !current?.source) return;
    const before = index === timeline.scoreStart + 1 ? undefined : timeline.frames[index - 1];
    return replayGamePosition(current.source, frame, before?.scores ?? { you: 0, opponent: 0 }, index);
  }, [historical, frame, timeline, index, current?.source]);
  const position = setup?.game;

  useEffect(() => {
    if (session && (session.source.id !== game?.id || session.source.archived !== game.archived))
      setSession(undefined);
  }, [session, game?.id, game?.archived]);
  useEffect(() => {
    if (!playing || !current) return;
    const timer = setTimeout(() => {
      setSession((previous) => previous === current ? {
        ...previous,
        index: index + 1,
        playing: index + 1 < last,
        showRecorded: index + 1 <= recordedCount,
      } : previous);
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [current, index, last, playing, recordedCount]);

  function close() {
    if (!current || !historical) return;
    focusAfterClose.current = current.returnFocus;
    setSession(undefined);
  }
  useLayoutEffect(() => {
    if (historical || !focusAfterClose.current) return;
    focusAfterClose.current.focus({ preventScroll: true });
    focusAfterClose.current = null;
  }, [historical]);

  function open(returnFocus: HTMLElement | null) {
    if (!game || !available) return;
    const timeline = archive?.timeline ?? gameReplayTimeline(game);
    setSession({
      source: game,
      timeline,
      index: game.archived ? 0 : timeline.frames.length - 1,
      showRecorded: !game.archived,
      playing: false,
      returnFocus,
    });
  }
  function seek(next: number) {
    if (!current) return;
    const index = Math.max(0, Math.min(next, last));
    if (index === current.index && !current.trial && !current.playing) return;
    setSession(index > recordedCount ? undefined : {
      ...current,
      index,
      playing: false,
      showRecorded: index > 0,
      trial: undefined,
    });
  }
  function togglePlay() {
    if (!current) return;
    const index = current.index >= last ? 0 : current.index;
    setSession({
      ...current,
      index,
      playing: !current.playing,
      showRecorded: true,
      trial: undefined,
    });
  }
  function hideRecorded() {
    if (current && (current.playing || current.showRecorded))
      setSession({ ...current, playing: false, showRecorded: false });
  }
  function toggleRecorded() {
    if (current && historical && !trial && frame?.position)
      setSession({ ...current, playing: false, showRecorded: !current.showRecorded });
  }
  function updateTrial(game: Game) {
    if (!current || !historical || position?.id !== game.id) return;
    setSession({ ...current, playing: false, showRecorded: false, trial: game });
  }
  function backToTurn() {
    if (current?.trial)
      setSession({ ...current, playing: false, showRecorded: current.index > 0, trial: undefined });
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || !shortcutsEnabled || event.isComposing ||
      document.querySelector("dialog[open]") ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!historical && !target?.closest(".board-replay-controls, .score-chart-range")) return;
    if (target?.closest(
      ".board-entry, .rack-entry, textarea, select, [contenteditable], input:not(.board-replay-slider, .score-chart-range)",
    )) return;
    if (event.key === "Escape" && historical) {
      event.preventDefault();
      if (trial) backToTurn();
      else close();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (target?.matches(".board-replay-slider")) {
        target.closest<HTMLElement>(".board-replay-controls")?.focus({ preventScroll: true });
      }
      seek(index + (event.key === "ArrowLeft" ? -1 : 1));
    } else if (event.key === " " && !target?.closest("summary, a, button:not(.board-replay-transport button)")) {
      event.preventDefault();
      if (!event.repeat) togglePlay();
    }
  });
  useEffect(() => {
    if (!current) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [!!current]);

  return {
    available,
    open,
    position: trial ?? position,
    historical,
    trial,
    hideRecorded,
    updateTrial,
    backToTurn,
    active: current && timeline && frame && {
      ...timeline,
      frame,
      rackLayout: trial ? undefined : setup?.rackLayout,
      index,
      last,
      recordedCount,
      historical,
      playing,
      showRecorded: current.showRecorded && !trial,
      seek,
      togglePlay,
      toggleRecorded,
      close,
    },
  };
}

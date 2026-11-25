import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gameReplayTimeline, hasRecordedMoves } from "../shared/game-replay";
import type { Game } from "../shared/model";

const STEP_MS = 1100;

type Session = ReturnType<typeof gameReplayTimeline> & {
  gameId: string;
  archived: boolean;
  index: number;
  playing: boolean;
  returnFocus: HTMLElement | null;
};

export function useGameReplay(
  game: Game | undefined,
  shortcutsEnabled: boolean,
) {
  const [session, setSession] = useState<Session>();
  const focusAfterClose = useRef<HTMLElement | null>(null);
  const active =
    session && session.gameId === game?.id && session.archived === game.archived
      ? session
      : undefined;
  const available = useMemo(() => !!game && hasRecordedMoves(game), [game]);
  const last = active ? active.frames.length - 1 : 0;
  const index = active?.index ?? 0;
  const playing = !!active?.playing;

  useEffect(() => {
    if (session && !active) setSession(undefined);
  }, [session, active]);
  useEffect(() => {
    if (!active?.playing) return;
    const timer = setTimeout(() => {
      setSession((current) =>
        current === active
          ? {
              ...current,
              index: current.index + 1,
              playing: current.index + 1 < last,
            }
          : current,
      );
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [active, last]);

  function close() {
    if (!active) return;
    focusAfterClose.current = active.returnFocus;
    setSession(undefined);
  }
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      !shortcutsEnabled ||
      event.isComposing ||
      document.querySelector("dialog[open]")
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      target?.closest(
        "textarea, select, [contenteditable], input:not(.board-replay-slider, .score-chart-range)",
      )
    )
      return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (target?.matches(".board-replay-slider")) {
        target
          .closest<HTMLElement>(".board-replay-controls")
          ?.focus({ preventScroll: true });
      }
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      seek((current) => current + direction);
    } else if (event.key === " ") {
      if (
        target?.closest("summary, a, button") &&
        !target.closest(".board-replay-transport")
      )
        return;
      event.preventDefault();
      if (!event.repeat) togglePlay();
    }
  });
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [!!active]);
  useLayoutEffect(() => {
    if (active || !focusAfterClose.current) return;
    focusAfterClose.current.focus();
    focusAfterClose.current = null;
  }, [active]);

  function open(returnFocus: HTMLElement | null) {
    if (!game || !available) return;
    const timeline = gameReplayTimeline(game);
    setSession({
      gameId: game.id,
      archived: game.archived,
      ...timeline,
      index: game.archived ? 0 : timeline.frames.length - 1,
      playing: false,
      returnFocus,
    });
  }
  function seek(next: number | ((index: number) => number)) {
    setSession(
      (current) =>
        current && {
          ...current,
          index: Math.max(
            0,
            Math.min(
              typeof next === "function" ? next(current.index) : next,
              current.frames.length - 1,
            ),
          ),
          playing: false,
        },
    );
  }
  function togglePlay() {
    setSession(
      (current) =>
        current && {
          ...current,
          index:
            current.index === current.frames.length - 1 ? 0 : current.index,
          playing: !current.playing,
        },
    );
  }
  return {
    available,
    open,
    active: active && {
      frames: active.frames,
      scoreStart: active.scoreStart,
      frame: active.frames[index],
      index,
      last,
      playing,
      seek,
      togglePlay,
      close,
    },
  };
}

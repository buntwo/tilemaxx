import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gameReplayFrames, hasRecordedMoves } from "../shared/game-replay";
import type { Game } from "../shared/model";

const STEP_MS = 1100;

type Session = {
  gameId: string;
  archived: boolean;
  frames: ReturnType<typeof gameReplayFrames>;
  index: number;
  playing: boolean;
  returnFocus: HTMLElement | null;
};

export function useGameReplay(game: Game | undefined, canUseEscape: boolean) {
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
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      !canUseEscape ||
      document.querySelector("dialog[open]")
    )
      return;
    event.preventDefault();
    close();
  });
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => onEscape(event);
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
    const frames = gameReplayFrames(game);
    setSession({
      gameId: game.id,
      archived: game.archived,
      frames,
      index: game.archived ? 0 : frames.length - 1,
      playing: false,
      returnFocus,
    });
  }
  function seek(next: number) {
    setSession(
      (current) =>
        current && {
          ...current,
          index: Math.max(0, Math.min(next, current.frames.length - 1)),
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

import { useEffect, useRef, useState } from "react";
import { minimumExchangeBag } from "../shared/exchange";
import type { Game, Move } from "../shared/model";
import type { PlayerExchangeAdvice } from "../shared/player-exchange";
import type { PlayerProfile } from "../shared/player-profiles";
import { rackSlotsForLetters } from "../shared/rack-entry";
import type { PracticeRequest, StyleExchangeMessage } from "./practice.worker";

export function useStyleExchange(
  game: Game | undefined,
  positionKey: string,
  searchId: number | undefined,
  profile: PlayerProfile | undefined,
  choice: { move?: Move } | undefined,
  bagSize: number,
  scorelessTurns: number,
  playerSeed: number,
) {
  const latest = useRef(game);
  latest.current = game;
  const eligible =
    game &&
    game.rack.length === game.template.rackSize &&
    !game.rack.includes(".") &&
    !game.requiredRackSlots?.length &&
    bagSize >= minimumExchangeBag(game.template, 1);
  const key =
    eligible && choice && profile && searchId !== undefined
      ? JSON.stringify([
          positionKey,
          searchId,
          profile,
          bagSize,
          scorelessTurns,
          playerSeed,
          choice.move?.id,
        ])
      : undefined;
  const [received, setReceived] = useState<{
    key: string;
    advice?: Omit<PlayerExchangeAdvice, "slots"> & { tiles: string };
  }>();
  useEffect(() => {
    const game = latest.current;
    if (!key || received?.key === key || !game || !profile) return;
    let worker: Worker | undefined;
    let current = true;
    const finish = (result?: PlayerExchangeAdvice) => {
      if (!current) return;
      current = false;
      worker?.terminate();
      worker = undefined;
      if (!result) return setReceived({ key });
      const { slots, ...advice } = result;
      setReceived({
        key,
        advice: {
          ...advice,
          tiles: slots.map((slot) => game.rack[slot]).join(""),
        },
      });
    };
    try {
      worker = new Worker(new URL("./practice.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }: MessageEvent<StyleExchangeMessage>) =>
        finish("result" in data ? data.result : undefined);
      worker.onerror = () => finish();
      const {
        board,
        rack,
        excludedRackSlots,
        requiredRackSlots,
        template,
        dictionaryId,
      } = game;
      worker.postMessage({
        kind: "style-exchange",
        dictionaryId,
        exchange: {
          board,
          rack,
          excludedRackSlots,
          requiredRackSlots,
          template,
          profile,
          move: choice?.move,
          bagSize,
          scorelessTurns,
          playerSeed,
        },
      } satisfies PracticeRequest);
    } catch {
      finish();
    }
    return () => {
      current = false;
      worker?.terminate();
    };
  }, [key, choice, profile, bagSize, scorelessTurns, playerSeed, received]);
  const pending = !!key && received?.key !== key;
  const result = !pending && key && received?.advice;
  const slots = game && result && rackSlotsForLetters(game, result.tiles);
  return {
    pending,
    advice:
      slots && result
        ? { ...result, slots: slots.sort((a, b) => a - b) }
        : undefined,
  };
}

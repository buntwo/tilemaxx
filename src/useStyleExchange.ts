import { useEffect, useRef, useState } from "react";
import { minimumExchangeBag } from "../shared/exchange";
import type { Game } from "../shared/model";
import type { MovePage } from "../shared/move-results";
import type { PlayerExchangeAdvice } from "../shared/player-exchange";
import type { PlayerProfile } from "../shared/player-profiles";
import { rackSlotsForLetters } from "../shared/rack-entry";
import type { PracticeRequest, StyleExchangeMessage } from "./practice.worker";

function withTiles(advice: PlayerExchangeAdvice, rack: string) {
  const { slots, ...detail } = advice;
  return { ...detail, tiles: slots.map((slot) => rack[slot]).join("") };
}

export function useStyleExchange(
  game: Game | undefined,
  positionKey: string,
  searchId: number | undefined,
  profile: PlayerProfile | undefined,
  choice: MovePage["styleChoice"],
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
    eligible && choice && !choice.exchange && profile === "strong" && searchId !== undefined
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
      setReceived({
        key,
        advice: withTiles(result, game.rack),
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
  const evaluated = eligible && choice?.exchange;
  const result = evaluated
    ? evaluated.advice && withTiles(evaluated.advice, evaluated.rack)
    : !pending && key && received?.advice;
  const slots = game && result && rackSlotsForLetters(game, result.tiles);
  return {
    pending,
    advice:
      slots && result
        ? { ...result, slots: slots.sort((a, b) => a - b) }
        : undefined,
  };
}

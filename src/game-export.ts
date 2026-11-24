import { createGameExport } from "../shared/game-export";
import type { Dictionary, Game } from "../shared/model";

export function downloadGame(game: Game, dictionaries: readonly Dictionary[]) {
  const snapshot = createGameExport(game, dictionaries);
  const file = new Blob([JSON.stringify(snapshot, null, 2) + "\n"], {
    type: "application/json;charset=utf-8",
  });
  const name = game.name.normalize().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-");
  const slug = [...name].slice(0, 48).join("").replace(/^-|-$/g, "") || "game";
  const date = game.startedOn && /^\d{4}-\d{2}-\d{2}$/.test(game.startedOn)
    ? `-${game.startedOn}`
    : "";
  const link = document.createElement("a");
  const url = URL.createObjectURL(file);
  link.href = url;
  link.download = `tilemaxx-${slug}${date}.json`;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to obtain the Blob for the download.
    setTimeout(URL.revokeObjectURL.bind(URL, url), 1000);
  }
}

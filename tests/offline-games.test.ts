import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameSummary } from "../shared/game-index";
import { offlineGamePlan } from "../src/offline-games";

test("offline setup prioritizes the open game then newest active saves across profiles", () => {
  const base: GameSummary = {
    id: "open",
    profileId: "first",
    name: "Offline",
    archived: false,
    revision: 3,
    startedOn: "2026-11-01",
    thumbnail: { size: 15, squares: "" },
    fullMoveHistory: false,
    score: null,
  };
  const games = [
    { ...base, id: "newest", profileId: "second", startedOn: "2026-11-18" },
    { ...base, id: "archived", archived: true },
    { ...base, id: "draft", revision: -1 },
    { ...base, id: "older", startedOn: "2026-11-12" },
    base,
  ];
  assert.deepEqual(offlineGamePlan(games, "open"), [
    { id: "open", revision: 3 },
    { id: "newest", revision: 3 },
    { id: "older", revision: 3 },
  ]);
  assert.deepEqual(
    offlineGamePlan(games, "archived").map(({ id }) => id),
    ["newest", "older", "open"],
  );
});

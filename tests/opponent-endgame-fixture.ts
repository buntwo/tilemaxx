import { emptyScoring } from "../shared/game-scoring";
import { Lexicon } from "../shared/lexicon";
import { applyMove, archiveGame, emptyBoard, type Game } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

export const opponentEndgameWords = [
  "AD",
  "ADD",
  "ADO",
  "ADS",
  "AS",
  "AT",
  "CAT",
  "CATS",
  "DA",
  "DAD",
  "DO",
  "DOAT",
  "DOT",
  "OAT",
  "OD",
  "ODA",
  "ODD",
  "OS",
  "SAT",
  "SO",
  "SOD",
  "TA",
  "TAD",
  "TAO",
  "TAT",
  "TO",
  "TOAD",
];

export function beforeRefill(): Game {
  const tiles = [..."ATCSDAOTD"];
  const template = {
    ...PRESETS[0],
    rackSize: 3,
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [
        letter,
        tiles.filter((tile) => tile === letter).length,
      ]),
    ),
  };
  const board = emptyBoard(template.size);
  board[template.start] = "A";
  board[template.start + 1] = "T";
  return {
    id: "g",
    profileId: "p",
    name: "First game",
    template,
    dictionaryId: "test",
    board,
    rack: "CSD",
    past: [],
    future: [],
    revision: 1,
    updatedAt: "",
    archived: false,
  };
}

export function playBeforeRefill() {
  const game = beforeRefill();
  const move = solve(
    new Lexicon(["CAT"]),
    game.board,
    game.rack,
    game.template,
  )[0];
  return applyMove(game, move, "you");
}

export function archivedBeforeEndgame(): Game {
  const played = playBeforeRefill();
  return archiveGame({
    ...played,
    id: "archived-endgame",
    name: "Archived endgame",
    past: [],
    template: {
      ...played.template,
      rackSize: 4,
      tileCounts: { ...played.template.tileCounts, O: 2 },
    },
    scoring: {
      ...emptyScoring(),
      end: { manual: true, scores: { you: 92, opponent: 84 } },
    },
  });
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type Move, type Premium } from "../shared/model";
import { moveLocation } from "../shared/notation";
import { createProfileDefense } from "../shared/player-profile-defense";
import { createPremiumLaneRisk } from "../shared/player-profile-lanes";
import { TILE_SYMBOLS, unseenTiles } from "../shared/tile-pool";
import { profileLeaveValue } from "../shared/rack-leave";
import { analyzeMoves } from "../shared/move-analysis";
import { MoveResultIndex } from "../shared/move-results";
import {
  createPlayerProfiles,
  PLAYER_PROFILES,
} from "../shared/player-profiles";
import { PRESETS, templateForLanguage } from "../shared/presets";
import { solve } from "../shared/solver";
import {
  createWordDifficulty,
  decodeWordFrequencies,
  wordFrequencyUrl,
} from "../shared/word-familiarity";

test("the upstream English asset decodes exact Zipf values and keeps inflections separate", () => {
  const frequencies = decodeWordFrequencies(
    gunzipSync(readFileSync(`public${wordFrequencyUrl("en")}`)),
    "en",
  );
  assert.equal(frequencies.get("SPATULA"), 2.86);
  assert.equal(frequencies.get("QAID"), 1.22);
  assert.equal(frequencies.get("WALKED"), 4.67);
  assert.notEqual(frequencies.get("WALK"), frequencies.get("WALKED"));
  assert.equal(frequencies.has("QOPH"), false);
});

test("nearest common legal spellings cover substitutions, deletions, insertions, and the cap", () => {
  const lexicon = new Lexicon([
    "ORANGE",
    "WALK",
    "WALKED",
    "ORANGES",
    "ORANG",
    "ORRANGE",
    "ORNG",
    "ORAAAXE",
    "ZYZZYVA",
    "ZZZZ",
  ]);
  const difficulty = createWordDifficulty(
    lexicon,
    new Map([
      ["ORANGE", 4.62],
      ["WALK", 5],
      ["WALKED", 2.5],
      ["ZZZ", 5],
    ]),
  );
  assert.deepEqual(difficulty("WALKED"), { difficulty: 1.5, missing: false });
  for (const word of ["ORANGES", "ORANG", "ORRANGE"])
    assert.deepEqual(difficulty(word), { difficulty: 12, missing: true }, word);
  assert.equal(difficulty("ORNG").difficulty, 16);
  assert.equal(difficulty("ORAAAXE").difficulty, 24);
  assert.equal(difficulty("ZYZZYVA").difficulty, 32);
  assert.equal(
    difficulty("ZZZZ").difficulty,
    32,
    "an illegal spelling cannot be an anchor",
  );
});

test("player vocabulary is stable across turns and gates newly formed crosswords", () => {
  const template = PRESETS[0];
  const lexicon = new Lexicon(["QI", "QIS", "SIT"]);
  const choose = createPlayerProfiles(
    lexicon,
    template,
    new Map([
      ["QI", 4],
      ["QIS", 4],
      ["SIT", 4],
    ]),
  );
  const board = emptyBoard(template.size);
  board[82] = "Q";
  board[97] = "I";
  const moves = solve(lexicon, board, "SIT", template);
  const hook = moves.find(
    (move) => move.word === "SIT" && move.crosses.includes("QIS"),
  )!;
  assert.ok(hook);
  const decision = (word: Move, seed: number, playerSeed: number) =>
    choose([word], "casual", {
      board,
      rack: "SIT",
      bagSize: 65,
      seed,
      playerSeed,
    });
  const withUnknownCross = { ...hook, crosses: ["QI"] };
  const seed = Array.from({ length: 100 }, (_, index) => index).find(
    (playerSeed) => !decision(withUnknownCross, 0, playerSeed).move,
  )!;
  assert.notEqual(seed, undefined);
  assert.equal(decision(withUnknownCross, 61, seed).move, undefined);
  assert.equal(decision(hook, 61, seed).move, hook);
});

test("vertical fluency rises with experience for the same known word", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const rack = "CAT";
  const lexicon = new Lexicon(["CAT"]);
  const choose = createPlayerProfiles(lexicon, template, new Map([["CAT", 4]]));
  const moves = solve(lexicon, board, rack, template);
  const [across, down] = (["across", "down"] as const).map(
    (direction) => moves.find((move) => move.direction === direction)!,
  );
  assert.ok(across && down);
  const counts = PLAYER_PROFILES.map((profile) => {
    let vertical = 0;
    for (let seed = 0; seed < 256; seed++) {
      const position = { board, rack, bagSize: 86, seed, playerSeed: 132 };
      assert.equal(choose([across], profile, position).move, across);
      if (choose([down], profile, position).move) vertical++;
    }
    return vertical;
  });
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2]);
});

test("word-list practice helps learners recall short words at equal corpus familiarity", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const lexicon = new Lexicon(["QI", "QAID"]);
  const choose = createPlayerProfiles(
    lexicon, template, new Map([["QI", 1.5], ["QAID", 1.5]]),
  );
  const rack = "QAID";
  const legal = solve(lexicon, board, rack, template);
  const noticed = (word: string, profile: "casual" | "learner") => {
    const move = legal.find((it) => it.word === word && it.direction === "across")!;
    assert.ok(move);
    let count = 0;
    for (let seed = 0; seed < 256; seed++) {
      const position = { board, rack, bagSize: 86, seed, playerSeed: seed ^ 456 };
      if (choose([move], profile, position).move) count++;
    }
    return count;
  };
  const shortGain = noticed("QI", "learner") - noticed("QI", "casual");
  const longGain = noticed("QAID", "learner") - noticed("QAID", "casual");
  assert.ok(shortGain > longGain);
  assert.ok(noticed("QI", "learner") > noticed("QAID", "learner"));
});

test("English short-word study does not gate common French or Italian words", () => {
  const preset = PRESETS.find(({ id }) => id === "lexulous")!;
  const lexicon = new Lexicon(["SI"]);
  const frequencies = new Map([["SI", 5]]);
  const board = emptyBoard(preset.size);
  const rack = "SI";
  const [move] = solve(lexicon, board, rack, preset);
  const choices = [preset, templateForLanguage(preset, "fr"), templateForLanguage(preset, "it")]
    .map((template) => createPlayerProfiles(lexicon, template, frequencies));
  const position = { board, rack, bagSize: 50, seed: 0, playerSeed: 0 };
  const playerSeed = Array.from({ length: 100 }, (_, seed) => seed).find(
    (seed) => !choices[0]([move], "casual", { ...position, playerSeed: seed }).move,
  );
  assert.notEqual(playerSeed, undefined);
  for (const choose of choices.slice(1))
    assert.equal(choose([move], "casual", { ...position, playerSeed: playerSeed! }).move, move);
});

test("profiles value shedding awkward duplicates and keeping flexible leaves", () => {
  assert.ok(profileLeaveValue("ION") > profileLeaveValue("IIINT"));
  assert.ok(profileLeaveValue("QU") > profileLeaveValue("QV"));
  assert.ok(profileLeaveValue("III?") > profileLeaveValue("IIII"));
  assert.ok(profileLeaveValue("SST") > profileLeaveValue("IIT"));
});

test("only Strong uses known-rack lookahead to adjust a close empty-bag choice", (context) => {
  const words = ["AT", "IT", "TA", "ZA", "ART", "RAT", "TAR"];
  const lexicon = new Lexicon(words);
  const rack = "AR";
  const available = "IT" + rack + "Z";
  const template = {
    ...PRESETS[0],
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [
        letter, [...available].filter((tile) => tile === letter).length,
      ]),
    ),
  };
  const board = emptyBoard(template.size);
  board[template.start] = "I";
  board[template.start + 1] = "T";
  const position = { board, rack, bagSize: 0, seed: 781, playerSeed: 48, scorelessTurns: 0 };
  const moves = solve(lexicon, board, rack, template);
  const create = () => createPlayerProfiles(
    lexicon, template, new Map(words.map((word) => [word, 5])),
  );
  const choose = create();
  const clock = context.mock.method(performance, "now", () => 0);
  const strong = choose(moves, "strong", position, { all: true, scoreOrdered: true });
  assert.equal(strong.beforeDefense?.word, "ART");
  assert.equal(strong.move?.word, "AT");
  assert.equal(strong.move?.leave, "R");
  assert.equal(strong.considered?.[0].utility.endgame, 24);
  assert.ok(strong.considered!.filter(({ move, utility }) => move.leave && utility.endgame !== undefined).length <= 5);
  assert.equal(
    choose(moves, "strong", position, { scoreOrdered: true }).move?.id,
    strong.move?.id,
  );
  for (const profile of ["casual", "learner"] as const)
    assert.ok(
      choose(moves, profile, position, { all: true }).considered!.every(
        ({ utility }) => utility.endgame === undefined,
      ),
    );
  const withTiles = choose(moves, "strong", { ...position, bagSize: 1 }, { all: true });
  assert.ok(withTiles.considered!.every(({ utility }) => utility.endgame === undefined));
  let now = 0;
  clock.mock.mockImplementation(() => (now += 10));
  const timedOut = create()(moves, "strong", position, { all: true, scoreOrdered: true });
  assert.equal(timedOut.move?.word, "ART");
  assert.ok(timedOut.considered!.every(({ utility }) => utility.endgame === undefined));
});

test("profile paging preserves style order and the raw points rank", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const moves = solve(
    new Lexicon(["CAT", "ACT", "AT"]),
    board,
    "CAT",
    template,
  );
  const index = new MoveResultIndex(moves, template);
  const low = moves.at(-1)!;
  const high = moves[0];
  const query = {
    filter: "",
    profile: "casual",
    sort: "playing-style",
    offset: 0,
  } as const;
  index.setProfile(
    query,
    [low, high].map((move) => ({
      move,
      utility: {
        total: move.score,
        points: move.score,
        premium: 0,
        familiarity: 0,
        crosswords: 0,
        length: 0,
        leave: 0,
        goingOut: 0,
      },
    })),
  );
  const page = index.page(query);
  assert.deepEqual(page.rows, [low, high]);
  assert.equal(page.scoreRanks[low.id], moves.length);
  const byPoints = index.page({ ...query, sort: "score" });
  assert.deepEqual(byPoints.rows, [high, low]);
  assert.equal(byPoints.utilities?.[low.id].rank, 1);
  assert.equal(byPoints.utilities?.[high.id].rank, 2);
  const filtered = index.page({ ...query, filter: high.word });
  assert.deepEqual(filtered.rows, [high]);
  assert.equal(filtered.styleChoice?.move, low);
  assert.deepEqual(Object.keys(filtered.utilities ?? {}), [high.id]);
  assert.equal(filtered.utilities?.[high.id].rank, 2);
  assert.equal(
    index.page({ ...query, profile: undefined }).utilities,
    undefined,
  );
  assert.equal(index.page({ ...query, profileScorelessTurns: 0 }).utilities, undefined);
  assert.equal(
    index.page({ ...query, profile: "strong" }).utilities,
    undefined,
  );
  assert.equal(
    index.page({ ...query, profile: undefined }).total,
    moves.length,
  );
});

test("Analyze produces the three modeled replies with the real shared picker", () => {
  const template = PRESETS[0];
  const lexicon = new Lexicon(["AT", "CAT", "CATS", "AS", "AX", "QI", "SIT"]);
  const board = emptyBoard(template.size);
  const rack = "CATSERT";
  const [candidate] = solve(lexicon, board, rack, template);
  const choose = createPlayerProfiles(
    lexicon,
    template,
    new Map(Array.from(lexicon.words(), (word) => [word, 4])),
  );
  const [forecast] = analyzeMoves(
    lexicon,
    {
      board,
      rack,
      template,
      candidates: [candidate],
      bagSize: 86,
      seed: 123,
      trials: 10,
    },
    choose,
  ).forecasts;
  assert.deepEqual(
    Object.keys(forecast.models).sort(),
    [...PLAYER_PROFILES].sort(),
  );
  for (const profile of PLAYER_PROFILES)
    assert.ok(Number.isFinite(forecast.models[profile].replyScore));
});

test("fast picking agrees with full ranked results on a two-blank rack", () => {
  const template = PRESETS[0];
  const lexicon = new Lexicon([
    "AS",
    "AT",
    "STAIR",
    "STRAIN",
    "STRAINS",
    "TRAIN",
    "TRAINS",
  ]);
  const choose = createPlayerProfiles(
    lexicon,
    template,
    new Map(Array.from(lexicon.words(), (word) => [word, 4])),
  );
  const board = emptyBoard(template.size);
  const rack = "AIRST??";
  const moves = solve(lexicon, board, rack, template);
  assert.ok(
    moves.some(({ tiles, blanks }) => tiles.length === 7 && blanks === 2),
  );
  for (const profile of PLAYER_PROFILES) {
    for (let seed = 0; seed < 20; seed++) {
      const position = { board, rack, bagSize: 86, seed, playerSeed: 81 };
      const fast = choose(moves, profile, position, { scoreOrdered: true });
      const full = choose(moves, profile, position, {
        scoreOrdered: true,
        all: true,
      });
      assert.equal(fast.move?.id, full.considered?.[0]?.move.id);
      for (const { utility } of full.considered ?? []) {
        const { total, ...factors } = utility;
        const sum = Object.values(factors).reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(total - sum) < 1e-8);
      }
    }
  }
});

test("only the stronger profiles account for new lanes, with Strong imposing the larger cost", () => {
  const template = PRESETS.find(({ id }) => id === "lexulous")!;
  const board = emptyBoard(template.size);
  board[18] = "H";
  board[33] = "E";
  const rack = "WWUTNKHE";
  const bagSize =
    unseenTiles({ board, rack }, template).total - template.rackSize;
  const words = ["HE", "WHEW", "WHEN"];
  const lexicon = new Lexicon(words);
  const choose = createPlayerProfiles(
    lexicon,
    template,
    new Map(words.map((word) => [word, 4])),
  );
  const legal = solve(lexicon, board, rack, template);
  const opening = legal.find(
    (move) => move.word === "WHEW" && moveLocation(move) === "D1",
  )!;
  const safer = legal.find(
    (move) => move.word === "WHEN" && moveLocation(move) === "2C",
  )!;
  assert.ok(opening && safer);
  const moves = [safer, opening];
  const position = { board, rack, bagSize, seed: 0, playerSeed: 17 };
  const penalties = PLAYER_PROFILES.map(
    (profile) =>
      choose(moves, profile, position, {
        all: true,
        scoreOrdered: true,
      }).considered!.find(({ move }) => move === opening)!.utility.premiumLane,
  );
  assert.deepEqual(
    penalties.map((value) => value?.toFixed(2)),
    [undefined, "-1.15", "-3.44"],
  );
  const strong = choose(moves, "strong", position, { scoreOrdered: true });
  assert.equal(strong.beforeDefense?.id, opening.id);
  assert.equal(strong.move?.id, safer.id);
  assert.equal(
    choose(
      moves,
      "strong",
      { ...position, bagSize: 0 },
      { all: true },
    ).considered!.find(({ move }) => move === opening)?.utility.premiumLane,
    undefined,
  );
});

test("Strong notices a new triple-letter hook only when the reply tile is unseen", () => {
  const preset = PRESETS[0];
  const premiums = preset.premiums.map<Premium>(() => "");
  premiums[preset.start - preset.size] = "TL";
  const board = emptyBoard(preset.size);
  const rack = "CAT";
  const lexicon = new Lexicon(["CAT", "ZA"]);
  const risk = (unseen: string) => {
    const template = {
      ...preset,
      premiums,
      tileCounts: Object.fromEntries(
        TILE_SYMBOLS.map((letter) => [
          letter, [...rack, ...unseen].filter((tile) => tile === letter).length,
        ]),
      ),
    };
    const move = solve(lexicon, board, rack, template).find(
      ({ direction, tiles }) => direction === "across" &&
        tiles.some(({ index, letter }) => index === template.start && letter === "A"),
    )!;
    assert.ok(move);
    return createProfileDefense(lexicon, template)({ board, rack }, 1, true)(move).hook;
  };
  assert.equal(risk("AZ"), 6.5);
  assert.equal(risk("AB"), 0);
});

test("a premium pair must fit one rack and have possible side words", () => {
  const template = PRESETS.find(({ id }) => id === "lexulous")!;
  const lexicon = new Lexicon(["AZ"]);
  const risk = createPremiumLaneRisk(template, (prefix, suffix) =>
    lexicon.crossMask(prefix, suffix),
  );
  const counts = Array<number>(27).fill(1);
  counts[26] = 0;
  const measure = (rackSize: number) => {
    const board = emptyBoard(template.size);
    board[16] = "Z"; // B2 requires an A at B1.
    const delta = risk(board, counts, rackSize)!;
    board[3] = "W";
    return delta();
  };
  assert.ok(measure(7) > 0);
  assert.equal(measure(6), 0);
  counts[0] = 0;
  assert.equal(measure(7), 0);
  counts[26] = 1;
  assert.ok(measure(7) > 0);
});

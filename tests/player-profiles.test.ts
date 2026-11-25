import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { rackPoints } from "../shared/endgame";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type Move, type Premium } from "../shared/model";
import { moveLocation } from "../shared/notation";
import { sampleProfilePlacements } from "../shared/player-profile-sampling";
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
import { packFamiliarity } from "../shared/profile-vocabulary";

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

test("Casual accepts only listed main words and crosses across vocabulary seeds", () => {
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
    { coverage: 4, appeal: 12 },
    new Set(["SIT", "AS"]),
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
  const known = { ...hook, crosses: ["as"] };
  const extension = moves.find((move) => move.word === "QIS")!;
  assert.ok(extension);
  for (const seed of [0, 61, 495]) {
    assert.equal(decision(known, seed, seed).move, known);
    assert.equal(decision(hook, seed, seed).move, undefined);
    assert.equal(decision(extension, seed, seed).move, undefined);
  }
});

test("Casual rolls once per game spelling for both main words and crosses", () => {
  const template = PRESETS[0];
  const lexicon = new Lexicon(["BAT", "CAT"]);
  const board = emptyBoard(template.size);
  const rack = "ABCATN?";
  const vocabulary = new Map([
    ["BAT", packFamiliarity(8_500)], ["CAT", packFamiliarity(9_000)], ["CATNAP", packFamiliarity(9_900)],
  ]);
  const choose = createPlayerProfiles(
    lexicon, template, new Map(), { coverage: 4, appeal: 0 }, undefined, vocabulary,
  );
  const moves = solve(lexicon, board, rack, template);
  const bat = moves.find((move) => move.word === "BAT")!;
  const cat = moves.find((move) => move.word === "CAT")!;
  assert.ok(bat && cat);
  assert.ok(moves.every((move) => move.word !== "CATNAP"));
  const catWithBat = { ...cat, crosses: ["BAT"] };
  let known = 0;
  for (let playerSeed = 0; playerSeed < 256; playerSeed++) {
    const position = { board, rack, bagSize: 70, seed: 0, playerSeed };
    const knowsBat = !!choose([bat], "casual", position).move;
    assert.equal(!!choose([catWithBat], "casual", { ...position, seed: 67 }).move, knowsBat);
    assert.equal(choose([cat], "casual", position).move, cat);
    if (knowsBat) known++;
  }
  assert.ok(known > 40 && known < 88, `BAT was known in ${known} of 256 games`);
});

test("vertical fluency rises with experience for the same known word", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const rack = "CAT";
  const lexicon = new Lexicon(["CAT"]);
  const choose = createPlayerProfiles(lexicon, template, new Map([["CAT", 4]]), undefined, new Set(["CAT"]));
  const moves = solve(lexicon, board, rack, template);
  const [across, down] = (["across", "down"] as const).map(
    (direction) => moves.find((move) => move.direction === direction)!,
  );
  assert.ok(across && down);
  const ratios = PLAYER_PROFILES.map((profile) => {
    const position = { board, rack, bagSize: 86, seed: 41, playerSeed: 132 };
    const { considered } = choose([across, down], profile, position, { all: true });
    const visibility = (move: Move) => considered!.find((entry) => entry.move === move)!.utility.visibility;
    return visibility(down) / visibility(across);
  });
  assert.ok(ratios[0] < ratios[1] && ratios[1] < ratios[2]);
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
  const noticed = (word: string) => {
    const move = legal.find((it) => it.word === word && it.direction === "across")!;
    assert.ok(move);
    let count = 0;
    for (let seed = 0; seed < 256; seed++) {
      const position = { board, rack, bagSize: 86, seed, playerSeed: seed ^ 456 };
      if (choose([move], "learner", position).move) count++;
    }
    return count;
  };
  assert.ok(noticed("QI") > noticed("QAID"));
});

test("English Casual vocabulary applies only in English games", () => {
  const preset = PRESETS.find(({ id }) => id === "lexulous")!;
  const lexicon = new Lexicon(["SI"]);
  const frequencies = new Map([["SI", 5]]);
  const board = emptyBoard(preset.size);
  const rack = "SI";
  const [move] = solve(lexicon, board, rack, preset);
  const choices = [preset, templateForLanguage(preset, "fr"), templateForLanguage(preset, "it")]
    .map((template) => createPlayerProfiles(lexicon, template, frequencies, undefined, new Set()));
  const position = { board, rack, bagSize: 50, seed: 0, playerSeed: 0 };
  assert.equal(choices[0]([move], "casual", position).move, undefined);
  for (const choose of choices.slice(1))
    assert.equal(choose([move], "casual", position).move, move);
});

test("late Casual and Learner favor familiar main words and crosses", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const rack = "ACOT";
  const lexicon = new Lexicon(["CAT", "COT", "AT", "OT"]);
  const choose = createPlayerProfiles(
    lexicon,
    template,
    new Map([["CAT", 5], ["COT", 1.21], ["AT", 5], ["OT", 1.21]]),
    undefined,
    new Set(lexicon.words()),
  );
  const legal = solve(lexicon, board, rack, template);
  const cat = legal.find((move) => move.word === "CAT" && move.direction === "across")!;
  const cot = legal.find((move) => move.word === "COT" && move.direction === "across")!;
  assert.ok(cat && cot);
  const moves = [
    cat,
    cot,
    { ...cat, id: "common-cross", crosses: ["AT"] },
    { ...cat, id: "rare-cross", crosses: ["OT"] },
  ];
  for (const profile of PLAYER_PROFILES) {
    const playerSeed = Array.from({ length: 256 }, (_, seed) => seed).find((seed) =>
      choose(moves, profile, { board, rack, bagSize: 20, seed: 0, playerSeed: seed }, { all: true })
        .considered?.length === moves.length,
    );
    assert.notEqual(playerSeed, undefined);
    const visibility = (bagSize: number) => new Map(
      choose(moves, profile, { board, rack, bagSize, seed: 0, playerSeed: playerSeed! }, { all: true })
        .considered!.map(({ move, utility }) => [move.id, utility.visibility]),
    );
    const early = visibility(20);
    const late = visibility(0);
    if (profile === "strong") {
      assert.deepEqual(late, early);
      continue;
    }
    assert.equal(late.get(cat.id), early.get(cat.id));
    assert.equal(late.get("common-cross"), early.get("common-cross"));
    for (const id of [cot.id, "rare-cross"]) {
      assert.ok(late.get(id)! < early.get(id)! / 20);
      assert.ok(visibility(4).get(id)! > late.get(id)!);
    }
  }
});

test("Casual and Learner penalize a second blank much more than the first", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const rack = "CAT??";
  const lexicon = new Lexicon(["CAT"]);
  const moves = solve(lexicon, board, rack, template).filter(
    (move) => move.word === "CAT" && move.direction === "across",
  );
  const choose = createPlayerProfiles(lexicon, template, new Map([["CAT", 5]]),
    undefined, new Set(lexicon.words()));
  for (const profile of PLAYER_PROFILES) {
    const result = choose(moves, profile, { board, rack, bagSize: 20, seed: 0, playerSeed: 0 }, { all: true });
    const visibility = [0, 1, 2].map((count) =>
      result.considered!.find(({ move }) => move.blanks === count)!.utility.visibility,
    );
    const first = visibility[1] / visibility[0];
    const second = visibility[2] / visibility[1];
    const relativePenalty = second / first;
    if (profile === "strong") assert.ok(Math.abs(relativePenalty - 1) < 1e-8);
    else assert.ok(relativePenalty < 0.2);
  }
});

test("profiles value shedding awkward duplicates and keeping flexible leaves", () => {
  assert.ok(profileLeaveValue("ION") > profileLeaveValue("IIINT"));
  assert.ok(profileLeaveValue("QU") > profileLeaveValue("QV"));
  assert.ok(profileLeaveValue("III?") > profileLeaveValue("IIII"));
  assert.ok(profileLeaveValue("SST") > profileLeaveValue("IIT"));
});

test("Learner gives the whole leave more weight, fading the boost as the bag empties", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const lexicon = new Lexicon(["CAT"]);
  const choose = createPlayerProfiles(
    lexicon, template, new Map([["CAT", 5]]), undefined, new Set(["CAT"]),
  );
  for (const rack of ["CATER?", "CATQVW"]) {
    const [move] = solve(lexicon, board, rack, template).filter(({ blanks }) => !blanks);
    assert.ok(move);
    const quality = profileLeaveValue(move.leave);
    const leaveAt = (profile: (typeof PLAYER_PROFILES)[number], bagSize: number) => {
      const decision = choose([move], profile, {
        board, rack, bagSize, seed: 0, playerSeed: 0,
      }, { all: true });
      return decision.considered![0].utility.leave;
    };
    const check = (actual: number, expected: number) =>
      assert.ok(Math.abs(actual - expected) < 1e-8, `Expected ${expected}, got ${actual}`);
    check(leaveAt("learner", 50), 0.98 * quality);
    check(leaveAt("learner", 7), 0.98 * quality);
    check(leaveAt("learner", 3), (0.56 + 0.42 * 3 / 7) * quality);
    check(leaveAt("learner", 0), -0.65 * rackPoints(move.leave, template.rules));
    check(leaveAt("casual", 50), 0.27 * quality);
    check(leaveAt("strong", 50), 0.85 * quality);
  }
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
    undefined, new Set(words),
  );
  const choose = create();
  const clock = context.mock.method(performance, "now", () => 0);
  const strong = choose(moves, "strong", position, { all: true });
  assert.equal(strong.beforeDefense?.word, "ART");
  assert.equal(strong.move?.word, "AT");
  assert.equal(strong.move?.leave, "R");
  assert.equal(strong.considered?.[0].utility.endgame, 24);
  assert.ok(strong.considered!.filter(({ move, utility }) => move.leave && utility.endgame !== undefined).length <= 5);
  assert.equal(
    choose(moves, "strong", position).move?.id,
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
  const timedOut = create()(moves, "strong", position, { all: true });
  assert.ok(timedOut.considered?.some(({ move }) => move.word === "ART"));
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
  const ranked = [low, high].map((move) => ({
    move,
    utility: {
      total: move.score,
      points: move.score,
      premium: 0,
      visibility: 1,
      appeal: 2,
      leave: 0,
      goingOut: 0,
    },
  }));
  index.setProfile(query, ranked);
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
  const resample = { ...query, profileSample: 1 };
  assert.equal(index.hasProfile(resample), false);
  assert.equal(index.page(resample).styleChoice, undefined);
  index.setProfile(resample, ranked.slice(1));
  assert.equal(index.hasProfile(resample), true);
  assert.equal(index.page(resample).styleChoice?.move, high);
  assert.equal(index.hasProfile(query), false);

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
    undefined,
    new Set(lexicon.words()),
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
    undefined,
    new Set(lexicon.words()),
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
      const fast = choose(moves, profile, position, { topThree: true });
      const full = choose(moves, profile, position, {
        all: true,
      });
      assert.equal(fast.move?.id, full.considered?.[0]?.move.id);
      assert.deepEqual(fast.suggestions, full.considered?.slice(0, 3).map(({ move }) => move));
      for (const { utility } of full.considered ?? []) {
        const { total, visibility, appeal, ...factors } = utility;
        assert.ok(visibility > 0 && visibility <= 1 && appeal > 0);
        const sum = Object.values(factors).reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(total - sum) < 1e-8);
      }
    }
  }
});

test("Casual and Learner use the same lane penalty, with Strong imposing a larger cost", () => {
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
    { coverage: 4, appeal: 12 },
    new Set(words),
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
      }).considered!.find(({ move }) => move === opening)!.utility.premiumLane,
  );
  assert.deepEqual(
    penalties.map((value) => value?.toFixed(2)),
    ["-1.15", "-1.15", "-3.44"],
  );
  const strong = choose(moves, "strong", position);
  assert.equal(strong.beforeDefense?.id, opening.id);

  for (const profile of PLAYER_PROFILES) {
    const solo = choose(moves, profile, { ...position, solo: true }, { all: true });
    assert.ok(solo.considered?.every(({ utility }) =>
      utility.defense === undefined && utility.premiumLane === undefined && utility.endgame === undefined));
  }
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

test("a localized search can miss familiar plays in a different part of the board", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  board[17] = "A";
  board[207] = "O";
  const rack = "CT";
  const words = ["CAT", "COT"];
  const lexicon = new Lexicon(words);
  const frequencies = new Map(words.map((word) => [word, 5]));
  const moves = solve(lexicon, board, rack, template);
  const knownWords = new Set(words);
  const local = createPlayerProfiles(lexicon, template, frequencies, { coverage: 0.5, appeal: 0 }, knownWords);
  const broad = createPlayerProfiles(lexicon, template, frequencies, { coverage: 4, appeal: 0 }, knownWords);
  const position = { board, rack, bagSize: 50, seed: 37, playerSeed: 17 };
  const known = broad(moves, "casual", position, { all: true }).considered!;
  assert.deepEqual([...new Set(known.map(({ move }) => move.word))].sort(), words);
  const visible = local(moves, "casual", position, { all: true }).considered!;
  assert.ok(visible.length > 0 && visible.length < known.length);
  const missed = known.find(({ move }) => !visible.some((entry) => entry.move === move))!.move;
  assert.equal(local([missed], "casual", position).move, undefined);
});

test("equivalent placements don't buy extra chances in the sampled order", () => {
  const template = PRESETS[0];
  const moves = solve(new Lexicon(["CAT", "ACT", "AT"]), emptyBoard(template.size), "CAT", template);
  const candidates = ["CAT", "ACT", "AT"].map((word) => ({
    move: moves.find((move) => move.word === word)!, weight: word === "CAT" ? 2 : 1,
  }));
  const clone = moves.find(({ word, id }) => word === "CAT" && id !== candidates[0].move.id)!;
  let cat = 0;
  for (let seed = 0; seed < 128; seed++) {
    const original = sampleProfilePlacements(candidates, seed, 3);
    const expanded = sampleProfilePlacements([...candidates, { move: clone, weight: 2 }], seed, 4);
    assert.deepEqual(expanded.slice(0, 3).map(({ move }) => move.word), original.map(({ move }) => move.word));
    assert.equal(sampleProfilePlacements(candidates, seed, 1)[0], original[0]);
    if (original[0].move.word === "CAT") cat++;
  }
  assert.ok(cat > 48 && cat < 80, `CAT chosen ${cat}/128 times, expected about 50%`);
});

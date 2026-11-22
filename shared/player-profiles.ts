import { rackPoints } from "./endgame";
import type { Lexicon } from "./lexicon";
import {
  isBingo,
  minimumBingoTiles,
  type BoardTemplate,
  type Move,
  type Position,
} from "./model";
import { createProfileDefense } from "./player-profile-defense";
import {
  createProfileEndgame,
  PROFILE_ENDGAME_TILES,
} from "./player-profile-endgame";
import { leaveTileValue, profileLeaveValue } from "./rack-leave";
import { choose, getTileCounts, unseenTiles } from "./tile-pool";
import {
  createWordDifficulty,
  wordFrequencyLanguage,
} from "./word-familiarity";

export const PLAYER_PROFILES = ["casual", "learner", "strong"] as const;
export type PlayerProfile = (typeof PLAYER_PROFILES)[number];
export const PLAYER_PROFILE_LABELS: Record<PlayerProfile, string> = {
  casual: "Casual",
  learner: "Word-List Learner",
  strong: "Strong Club Player",
};

const presets = {
  casual: {
    focus: 0.32,
    hookAttention: 0.1,
    vocabulary: 0.18,
    shortWords: 0.35,
    study: 0,
    vertical: 0.85,
    bingo: 0.2,
    blank: 0.55,
    score: 0.6,
    premium: 3,
    frequency: 1.25,
    missing: 0.9,
    cross: 1.5,
    length: 3,
    leave: 0.27,
    premiumLane: 0,
    endRack: 0.35,
    finish: 3,
    finalists: 1,
  },
  learner: {
    focus: 0.38,
    hookAttention: 0,
    vocabulary: 0.07,
    shortWords: 0.96,
    study: 0.5,
    vertical: 0.94,
    bingo: 0.52,
    blank: 0.75,
    score: 0.85,
    premium: 1,
    frequency: 0.55,
    missing: 0.45,
    cross: 0.85,
    length: 1.5,
    leave: 0.56,
    premiumLane: 1,
    endRack: 0.65,
    finish: 6,
    finalists: 3,
  },
  strong: {
    focus: 0.75,
    hookAttention: 0,
    vocabulary: 0.025,
    shortWords: 0.995,
    study: 0.72,
    vertical: 0.99,
    bingo: 0.86,
    blank: 0.92,
    score: 1,
    premium: 0,
    frequency: 0.25,
    missing: 0.2,
    cross: 0.4,
    length: 0.75,
    leave: 0.85,
    premiumLane: 3,
    endRack: 1,
    finish: 0,
    finalists: 5,
  },
};

const studyWords = new Set(
  "AA AE AI AR DA EF EL EM EN ER ES ET FE GI HM JO KA KI LI MI MM MU NA NE NU OD OE OM OS PE QI SI TA TE TI UT WO XI XU YA ZA".split(
    " ",
  ),
);
const scale = 2 ** 32;
type WordProfile = {
  hash: number;
  knowledge: number;
  recall: number;
  penalty: number;
};

function mix(value: number) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function profileWordHash(text: string) {
  let hash = 2166136261;
  for (const character of text)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash;
}

export type ProfilePosition = Position & {
  bagSize: number;
  seed: number;
  playerSeed: number;
  solo?: true;
  scorelessTurns?: number;
};
export type ProfileUtility = {
  total: number;
  points: number;
  premium: number;
  familiarity: number;
  crosswords: number;
  length: number;
  leave: number;
  goingOut: number;
  endgame?: number;
  defense?: number;
  premiumLane?: number;
};

export type RankedProfileMove = { move: Move; utility: ProfileUtility };
export type ProfileDecision = {
  move?: Move;
  bingoFound: boolean;
  considered?: RankedProfileMove[];
  withoutLeave?: Move;
  beforeDefense?: Move;
  topReason?:
    | "placement"
    | "vocabulary"
    | "recall"
    | "rank"
    | "leave"
    | "defense"
    | "endgame"
    | "found";
};

export function createPlayerProfiles(
  lexicon: Lexicon,
  template: BoardTemplate,
  frequencies: ReadonlyMap<string, number>,
) {
  const difficulty = createWordDifficulty(lexicon, frequencies);
  const casualStudyWords = wordFrequencyLanguage(template.rules) === "en"
    ? studyWords
    : undefined;
  const counts = getTileCounts(template);
  const bagTiles = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const bingoLength = minimumBingoTiles(template);
  const rackDraws = [
    choose(bagTiles, bingoLength),
    choose(bagTiles, bingoLength + 1),
  ];
  function studyPriority(spelling: string) {
    if (spelling.length === 2) return 1;
    if (spelling.length === 3) return 0.6;
    const span = spelling.length - bingoLength;
    if (span < 0 || span > 1) return 0;
    // Players study likely alphagrams. Exact spellings still have their own
    // vocabulary rolls, including when two spellings share the same tiles.
    const used: Record<string, number> = {};
    let combinations = 1;
    for (const letter of spelling) {
      const copies = (used[letter] ?? 0) + 1;
      combinations *= ((counts[letter] ?? 0) - copies + 1) / copies;
      if (combinations <= 0) return 0;
      used[letter] = copies;
    }
    const rate = combinations / rackDraws[span];
    // Smoothly scale up to alphagrams seen roughly once per 10,000 draws.
    return 0.65 * Math.min(1, Math.sqrt(rate * 10_000));
  }
  const wordCache = new Map<
    string,
    {
      hash: number;
      data: Partial<Record<PlayerProfile, WordProfile>>;
      difficulty: number;
      missing: boolean;
      study?: number;
    }
  >();
  function wordData(word: string, profile: PlayerProfile) {
    const spelling = word.toUpperCase();
    let wordInfo = wordCache.get(spelling);
    if (!wordInfo) {
      wordInfo = {
        hash: profileWordHash(spelling),
        data: {},
        ...difficulty(spelling),
      };
      wordCache.set(spelling, wordInfo);
    }
    const cached = wordInfo.data[profile];
    if (cached) return cached;
    const preset = presets[profile];
    const study = preset.study ? (wordInfo.study ??= studyPriority(spelling)) : 0;
    const adjusted = wordInfo.difficulty * (1 - preset.study * study);
    return (wordInfo.data[profile] = {
      hash: wordInfo.hash,
      knowledge:
        Math.min(
          Math.exp(-0.72 * preset.vocabulary * adjusted),
          (profile === "casual" ? casualStudyWords?.has(spelling) : spelling.length === 2)
            ? preset.shortWords
            : 1,
        ) * scale,
      recall: Math.exp(-0.28 * preset.vocabulary * adjusted) * scale,
      penalty:
        adjusted * (wordInfo.missing ? preset.missing : preset.frequency),
    });
  }

  const { size, premiums } = template;
  const lengthChance = Object.fromEntries(
    PLAYER_PROFILES.map((profile) => [
      profile,
      Array.from(
        { length: template.rackSize + 1 },
        (_, tiles) => presets[profile].bingo ** (Math.max(0, tiles - 5) / 2),
      ),
    ]),
  ) as Record<PlayerProfile, number[]>;
  const blankChance = Object.fromEntries(
    PLAYER_PROFILES.map((profile) => [
      profile,
      Array.from(
        { length: template.rackSize + 1 },
        (_, blanks) => presets[profile].blank ** blanks,
      ),
    ]),
  ) as Record<PlayerProfile, number[]>;
  const salience = premiums.map((premium) =>
    premium === "TW" || premium === "TL" || premium === "QW" || premium === "QL"
      ? 1
      : premium
        ? 0.4
        : 0,
  );
  const neighbors = premiums.map((_, cell) =>
    [
      cell % size ? cell - 1 : -1,
      cell % size !== size - 1 ? cell + 1 : -1,
      cell >= size ? cell - size : -1,
      cell + size < premiums.length ? cell + size : -1,
    ].filter((next) => next >= 0),
  );
  let defense: ReturnType<typeof createProfileDefense> | undefined;
  let endgame: ReturnType<typeof createProfileEndgame> | undefined;

  function attention(position: ProfilePosition, profile: PlayerProfile) {
    const { board, seed } = position;
    const { focus, hookAttention } = presets[profile];
    const choices: { cell: number; priority: number }[] = [];
    for (let cell = 0; cell < board.length; cell++) {
      let adjacent = 0;
      for (const neighbor of neighbors[cell]) if (board[neighbor]) adjacent++;
      if (!board[cell] && !adjacent) continue;
      const bonus = board[cell]
        ? 0.15
        : (0.35 + hookAttention) * salience[cell] +
          (adjacent === 1 ? 0.14 + hookAttention : 0);
      choices.push({
        cell,
        priority: mix(seed ^ Math.imul(cell + 1, 0x85ebca6b)) / scale + bonus,
      });
    }
    const selected = new Uint8Array(board.length);
    if (!choices.length) selected[template.start] = 1;
    choices.sort((a, b) => b.priority - a.priority || a.cell - b.cell);
    const count = Math.min(
      choices.length,
      Math.max(4, Math.ceil(focus * choices.length)),
    );
    for (let index = 0; index < count; index++)
      selected[choices[index].cell] = 1;
    return selected;
  }

  function coversAttention(move: Move, selected: Uint8Array) {
    let cell = move.row * size + move.col;
    const step = move.direction === "across" ? 1 : size;
    for (let index = 0; index < move.word.length; index++, cell += step)
      if (selected[cell]) return true;
    return false;
  }

  function visibleCrossHook(
    move: Move,
    board: Position["board"],
    selected?: Uint8Array,
  ) {
    const across = move.direction === "across";
    const step = across ? size : 1;
    for (const { index } of move.tiles) {
      if (selected && !selected[index]) continue;
      const coordinate = across ? Math.floor(index / size) : index % size;
      const before = coordinate > 0 && Boolean(board[index - step]);
      const after = coordinate < size - 1 && Boolean(board[index + step]);
      if (before !== after) return true;
    }
    return false;
  }

  return (
    moves: readonly Move[],
    profile: PlayerProfile,
    position: ProfilePosition,
    options: { all?: boolean; scoreOrdered?: boolean; metrics?: boolean } = {},
  ): ProfileDecision => {
    if (!moves.length)
      return { bingoFound: false, considered: options.all ? [] : undefined };
    const preset = presets[profile];
    const { bagSize, board, seed, playerSeed, rack, solo, scorelessTurns } = position;
    const emptyBag = bagSize === 0 && template.rules !== "crossplay";
    const pool = !solo && emptyBag && profile === "strong"
      ? unseenTiles(position, template)
      : undefined;
    const canTrack = pool && !pool.excess.length && pool.total <= template.rackSize;
    const planEndgame =
      canTrack &&
      scorelessTurns !== undefined &&
      pool.total > 0 &&
      rack.replaceAll(".", "").length + pool.total <= PROFILE_ENDGAME_TILES;
    const shortlistSize = !solo && (bagSize > 0 || planEndgame) ? preset.finalists : 1;
    const shortlist: {
      move: Move;
      value: number;
      index: number;
      utility?: ProfileUtility;
    }[] = [];
    const ranked: typeof shortlist = [];
    const knownWords = new Map<WordProfile, boolean>();
    const leaveScores = new Map<string, number>();
    const rackOut = canTrack
      ? 2 * pool.tiles.reduce((sum, tile) => sum + tile.count * tile.score, 0)
      : (emptyBag ? preset.finish : 0);
    const maxLeave = bagSize
      ? preset.leave *
        [...rack].reduce(
          (sum, letter) => sum + Math.max(0, leaveTileValue(letter)),
          0,
        )
      : rackOut;
    let checkedEndgame = false;
    let bingoFound = false;
    let withoutLeave: Move | undefined;
    let bestBase = -Infinity;
    let topReason: ProfileDecision["topReason"];
    const rawFirst = options.metrics ? moves[0].id : undefined;

    function knows(data: WordProfile) {
      let result = knownWords.get(data);
      if (result === undefined) {
        result = mix(data.hash ^ playerSeed) < data.knowledge;
        knownWords.set(data, result);
      }
      return result;
    }

    function scan(selected?: Uint8Array) {
      for (const [index, move] of moves.entries()) {
        const ceiling = preset.score * move.score + preset.premium;
        const bingo = isBingo(template, move.tiles.length);
        if (
          !options.all &&
          shortlist.length === shortlistSize &&
          shortlist[shortlistSize - 1].value > ceiling + maxLeave &&
          (!options.metrics || ((bingoFound || !bingo) && bestBase > ceiling))
        ) {
          if (options.scoreOrdered && (!options.metrics || bingoFound)) break;
          continue;
        }
        const reject = (reason: ProfileDecision["topReason"]) => {
          if (move.id === rawFirst) topReason = reason;
        };
        if (selected && !coversAttention(move, selected)) {
          reject("placement");
          continue;
        }
        const word = wordData(move.word, profile);
        if (!knows(word)) {
          reject("vocabulary");
          continue;
        }
        const extra = Math.max(0, move.tiles.length - 5);
        const first = move.row * size + move.col;
        const last =
          first +
          (move.word.length - 1) * (move.direction === "across" ? 1 : size);
        const simpleExtension =
          move.tiles.length === 1 &&
          move.word.length >= 3 &&
          !move.blanks &&
          (move.tiles[0].index === first || move.tiles[0].index === last);
        if (!simpleExtension) {
          const probability =
            word.recall *
            lengthChance[profile][move.tiles.length] *
            (extra ? blankChance[profile][move.blanks] : 1) *
            (move.direction === "down" && move.word.length > 2
              ? preset.vertical
              : 1);
          const roll = mix(word.hash ^ seed);
          if (
            roll >= probability &&
            (extra ||
              !move.crosses.length ||
              roll >= Math.min(scale, probability * 1.7) ||
              !visibleCrossHook(move, board, selected))
          ) {
            reject("recall");
            continue;
          }
        }
        let penalty = word.penalty;
        let valid = true;
        for (const cross of move.crosses) {
          const data = wordData(cross, profile);
          if (!knows(data)) {
            valid = false;
            break;
          }
          penalty = Math.max(penalty, data.penalty);
        }
        if (!valid) {
          reject("vocabulary");
          continue;
        }
        reject("found");
        bingoFound ||= bingo;
        let premium = 0;
        if (preset.premium)
          for (const tile of move.tiles)
            premium = Math.max(premium, salience[tile.index]);
        const points = preset.score * move.score;
        const premiumBonus = preset.premium * premium;
        const crosswords = -preset.cross * move.crosses.length;
        const length = -preset.length * extra;
        const base = points + premiumBonus - penalty + crosswords + length;
        if (options.metrics && base > bestBase) {
          bestBase = base;
          withoutLeave = move;
        }
        let leave = 0;
        const goingOut = emptyBag && !move.leave ? rackOut : 0;
        if (bagSize || emptyBag) {
          let estimate = leaveScores.get(move.leave);
          if (estimate === undefined) {
            estimate = emptyBag
              ? -preset.endRack * rackPoints(move.leave, template.rules)
              : preset.leave * profileLeaveValue(move.leave);
            leaveScores.set(move.leave, estimate);
          }
          leave = estimate;
        }
        const value = base + leave + goingOut;
        const entry: (typeof shortlist)[number] = { move, value, index };
        if (options.all) {
          entry.utility = {
            total: value,
            points,
            premium: premiumBonus,
            familiarity: -penalty,
            crosswords,
            length,
            leave,
            goingOut,
          };
          ranked.push(entry);
        }
        // Immediate rack-outs have the same continuation. Only their best
        // placement needs a finalist slot.
        if (planEndgame && !move.leave) {
          const existing = shortlist.findIndex((item) => !item.move.leave);
          if (existing >= 0) {
            if (value <= shortlist[existing].value + 1e-7) continue;
            shortlist.splice(existing, 1);
          }
        }
        const slot = shortlist.findIndex((item) => value > item.value + 1e-7);
        if (slot >= 0) shortlist.splice(slot, 0, entry);
        else if (shortlist.length < shortlistSize) shortlist.push(entry);
        if (shortlist.length > shortlistSize) shortlist.pop();
      }
    }

    scan(attention(position, profile));
    if (!shortlist.length) scan();
    const beforeDefense = shortlist[0]?.move;
    if (!solo && bagSize > 0 && shortlist.length > 1) {
      const risk = (defense ??= createProfileDefense(lexicon, template))(
        position,
        bagSize,
        profile === "strong",
      );
      for (const entry of shortlist) {
        const { hook, lane } = risk(entry.move);
        const hookAdjustment = hook === undefined ? undefined : -0.65 * hook;
        const laneAdjustment =
          lane === undefined ? undefined : -preset.premiumLane * lane;
        entry.value += (hookAdjustment ?? 0) + (laneAdjustment ?? 0);
        if (entry.utility) {
          if (hookAdjustment !== undefined)
            entry.utility.defense = hookAdjustment;
          if (laneAdjustment !== undefined)
            entry.utility.premiumLane = laneAdjustment;
          entry.utility.total = entry.value;
        }
      }
      shortlist.sort((a, b) => b.value - a.value);
    } else if (planEndgame && shortlist.length > 1) {
      const spreads = (endgame ??= createProfileEndgame(lexicon, template))(
        board,
        pool,
        scorelessTurns,
        shortlist.map(({ move }) => move),
      );
      if (spreads) {
        checkedEndgame = true;
        for (const [index, entry] of shortlist.entries()) {
          const leave = -preset.endRack * rackPoints(entry.move.leave, template.rules);
          const goingOut = entry.move.leave ? 0 : rackOut;
          // Replace the static rack projection with the spread from the line.
          const adjustment = spreads[index] - entry.move.score - leave - goingOut;
          entry.value += adjustment;
          if (entry.utility) {
            entry.utility.endgame = adjustment;
            entry.utility.total = entry.value;
          }
        }
        shortlist.sort((a, b) => b.value - a.value);
      }
    }
    const move = shortlist[0]?.move;
    if (topReason === "found" && move?.id !== moves[0].id)
      topReason =
        beforeDefense?.id === moves[0].id
          ? (checkedEndgame ? "endgame" : "defense")
          : withoutLeave?.id === moves[0].id
            ? "leave"
            : "rank";
    let considered: RankedProfileMove[] | undefined;
    if (options.all) {
      const byUtility = (a: (typeof ranked)[number], b: (typeof ranked)[number]) =>
        b.value - a.value || a.index - b.index;
      const first = bagSize || checkedEndgame
        ? [...shortlist]
        : shortlist.slice(0, 1);
      const finalists = new Set(first.map((entry) => entry.move));
      const rest: typeof ranked = [];
      for (const entry of ranked) {
        if (finalists.has(entry.move)) continue;
        if (checkedEndgame && !entry.move.leave) {
          // This spread is known without another solve.
          entry.utility!.endgame = 0;
          first.push(entry);
        } else rest.push(entry);
      }
      if (checkedEndgame) first.sort((a, b) => b.value - a.value);
      considered = [...first, ...rest.sort(byUtility)].map(
        ({ move, utility }) => ({ move, utility: utility! }),
      );
    }
    return {
      move,
      bingoFound,
      considered,
      withoutLeave,
      beforeDefense,
      topReason,
    };
  };
}

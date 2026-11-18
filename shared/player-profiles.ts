import type { Lexicon } from "./lexicon";
import { isBingo, type BoardTemplate, type Move, type Position } from "./model";
import { createProfileDefense } from "./player-profile-defense";
import { leaveValue } from "./rack-leave";
import { unseenTiles } from "./tile-pool";
import { createWordDifficulty } from "./word-familiarity";

export const PLAYER_PROFILES = ["casual", "learner", "strong"] as const;
export type PlayerProfile = (typeof PLAYER_PROFILES)[number];
export const PLAYER_PROFILE_LABELS: Record<PlayerProfile, string> = {
  casual: "Casual",
  learner: "Word-list learner",
  strong: "Strong club player",
};

const presets = {
  casual: {
    focus: 0.225,
    hookAttention: 0.1,
    vocabulary: 0.18,
    shortWords: 0.35,
    bingo: 0.2,
    blank: 0.55,
    score: 0.6,
    premium: 3,
    frequency: 1.25,
    missing: 0.9,
    cross: 1.5,
    length: 3,
    leave: 0.15,
  },
  learner: {
    focus: 0.38,
    hookAttention: 0,
    vocabulary: 0.07,
    shortWords: 0.9,
    bingo: 0.52,
    blank: 0.75,
    score: 0.85,
    premium: 1,
    frequency: 0.55,
    missing: 0.45,
    cross: 0.85,
    length: 1.5,
    leave: 0.4,
  },
  strong: {
    focus: 0.75,
    hookAttention: 0,
    vocabulary: 0.025,
    shortWords: 0.99,
    bingo: 0.86,
    blank: 0.92,
    score: 1,
    premium: 0,
    frequency: 0.25,
    missing: 0.2,
    cross: 0.4,
    length: 0.75,
    leave: 0.85,
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
  defense?: number;
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
    | "found";
};

export function createPlayerProfiles(
  lexicon: Lexicon,
  template: BoardTemplate,
  frequencies: ReadonlyMap<string, number>,
) {
  const difficulty = createWordDifficulty(lexicon, frequencies);
  const wordCache = new Map<
    string,
    {
      hash: number;
      data: Partial<Record<PlayerProfile, WordProfile>>;
      difficulty: number;
      missing: boolean;
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
    const preset = presets[profile];
    return (wordInfo.data[profile] ??= {
      hash: wordInfo.hash,
      knowledge:
        Math.min(
          Math.exp(-0.72 * preset.vocabulary * wordInfo.difficulty),
          studyWords.has(spelling) ? preset.shortWords : 1,
        ) * scale,
      recall: Math.exp(-0.28 * preset.vocabulary * wordInfo.difficulty) * scale,
      penalty:
        wordInfo.difficulty *
        (wordInfo.missing ? preset.missing : preset.frequency),
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
    const { bagSize, board, seed, playerSeed, rack } = position;
    const canDefend = profile === "strong" && bagSize > 0;
    const shortlistSize = canDefend ? 4 : 1;
    const shortlist: {
      move: Move;
      value: number;
      index: number;
      utility?: ProfileUtility;
    }[] = [];
    const ranked: typeof shortlist = [];
    const knownWords = new Map<WordProfile, boolean>();
    const leaveScores = new Map<string, number>();
    const rackOut =
      profile === "strong" && !bagSize && template.rules !== "crossplay"
        ? 2 *
          unseenTiles(position, template).tiles.reduce(
            (sum, tile) => sum + tile.count * tile.score,
            0,
          )
        : 0;
    const maxLeave = bagSize
      ? preset.leave *
        [...rack].reduce(
          (sum, letter) =>
            sum +
            (letter === "?"
              ? 12
              : letter === "S"
                ? 5
                : "AERNT".includes(letter)
                  ? 1
                  : 0),
          0,
        )
      : rackOut;
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
          (move.tiles[0].index === first || move.tiles[0].index === last);
        if (!simpleExtension) {
          const probability =
            word.recall *
            (extra
              ? lengthChance[profile][move.tiles.length] *
                blankChance[profile][move.blanks]
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
        const goingOut = !bagSize && !move.leave ? rackOut : 0;
        if (bagSize) {
          let estimate = leaveScores.get(move.leave);
          if (estimate === undefined) {
            estimate = leaveValue(move.leave);
            leaveScores.set(move.leave, estimate);
          }
          leave = preset.leave * estimate;
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
        const slot = shortlist.findIndex((item) => value > item.value + 1e-7);
        if (slot >= 0) shortlist.splice(slot, 0, entry);
        else if (shortlist.length < shortlistSize) shortlist.push(entry);
        if (shortlist.length > shortlistSize) shortlist.pop();
      }
    }

    scan(attention(position, profile));
    if (!shortlist.length) scan();
    const beforeDefense = shortlist[0]?.move;
    if (canDefend && shortlist.length > 1) {
      const risk = (defense ??= createProfileDefense(lexicon, template))(
        position,
        bagSize,
      );
      for (const entry of shortlist) {
        const adjustment = -0.65 * risk(entry.move);
        entry.value += adjustment;
        if (entry.utility) {
          entry.utility.defense = adjustment;
          entry.utility.total = entry.value;
        }
      }
      shortlist.sort((a, b) => b.value - a.value);
    }
    const move = shortlist[0]?.move;
    if (topReason === "found" && move?.id !== moves[0].id)
      topReason =
        beforeDefense?.id === moves[0].id
          ? "defense"
          : withoutLeave?.id === moves[0].id
            ? "leave"
            : "rank";
    let considered: RankedProfileMove[] | undefined;
    if (options.all) {
      const finalists = new Set(shortlist.map((entry) => entry.move));
      considered = [
        ...shortlist,
        ...ranked
          .filter((entry) => !finalists.has(entry.move))
          .sort((a, b) => b.value - a.value || a.index - b.index),
      ].map(({ move, utility }) => ({ move, utility: utility! }));
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

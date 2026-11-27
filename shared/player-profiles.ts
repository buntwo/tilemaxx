import { rackPoints } from "./endgame";
import { learnerRackCues } from "./learner-attention";
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
import { createProfileRackOut } from "./player-profile-rack-out";
import {
  DEFAULT_PROFILE_APPEAL,
  learnerAppeal,
  learnerLogAppeal,
  mixProfileSeed,
  profileAppeal,
  profileAttention,
  profileWordHash,
  sampleProfilePlacements,
} from "./player-profile-sampling";
import { profileLeaveValue } from "./rack-leave";
import {
  casualWordProbability,
  learnerWordProbability,
  type EnglishProfileVocabulary,
} from "./profile-vocabulary";
import { splitRack } from "./rack-entry";
import { choose, endgameOpponentRack, getTileCounts, unseenTiles } from "./tile-pool";
import {
  createWordDifficulty,
  wordFrequencyLanguage,
} from "./word-familiarity";

export { profileWordHash } from "./player-profile-sampling";

export const PLAYER_PROFILES = ["casual", "learner", "strong"] as const;
export type PlayerProfile = (typeof PLAYER_PROFILES)[number];
export const LEARNER_HALF_LIFE = { casual: 10, learner: 3 } as const;
export type LearnerStyle = keyof typeof LEARNER_HALF_LIFE;
export function usesLearnerPolicy(profile: string | undefined): profile is LearnerStyle {
  return profile === "casual" || profile === "learner";
}
export const PLAYER_PROFILE_LABELS: Record<PlayerProfile, string> = {
  casual: "Casual",
  learner: "Learner",
  strong: "Strong",
};

const presets = {
  learner: {
    focus: 0.38,
    hookAttention: 0,
    vocabulary: 0.13,
    shortWords: 0.96,
    study: 0.65,
    vertical: 0.94,
    bingo: 0.72,
    blank: 0.75,
    secondBlank: 0.18,
    lateFamiliarity: 0.65,
    score: 0.85,
    premium: 1,
    cross: 0.85,
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
    secondBlank: 1,
    lateFamiliarity: 0,
    score: 1,
    premium: 0,
    cross: 0.4,
    leave: 0.85,
    premiumLane: 3,
    endRack: 1,
    finish: 0,
    finalists: 5,
  },
};
type Model = keyof typeof presets;
const models = ["learner", "strong"] as const;

function lateProfileFamiliarityWeight(bagSize: number, rackSize: number) {
  return Math.max(0, 1 - bagSize / rackSize);
}

const scale = 2 ** 32;
type WordProfile = {
  hash: number;
  knowledge: number;
  recall: number;
};

export interface ProfileSampling {
  coverage: number;
  appeal: number;
}

const defaultSampling: ProfileSampling = { coverage: 1, appeal: DEFAULT_PROFILE_APPEAL };

export type ProfilePosition = Position & {
  bagSize: number;
  seed: number;
  playerSeed: number;
  solo?: true;
  scorelessTurns?: number;
  scoreSpread?: number;
};
export type ProfileUtility = {
  total: number;
  points: number;
  premium: number;
  visibility: number;
  appeal: number;
  leave: number;
  goingOut: number;
  endgame?: number;
  lookahead?: number;
  modeledReply?: number;
  modeledFollowUp?: number;
  lookaheadDeals?: number;
  selection?: "winning-rack-out" | "known-rack";
  defense?: number;
  premiumLane?: number;
};

export type LearnerCandidate = {
  move: Move;
  value: number;
  visibility: number;
};

export type RankedProfileMove = { move: Move; utility: ProfileUtility };
export type ProfileDecision = {
  move?: Move;
  bingoFound: boolean;
  considered?: RankedProfileMove[];
  learnerSlate?: LearnerCandidate[];
  suggestions?: Move[];
  visibleIdeas?: number;
  withoutLeave?: Move;
  beforeDefense?: Move;
  topReason?: "placement" | "vocabulary" | "recall" | "rank" | "found";
};

export function createPlayerProfiles(
  lexicon: Lexicon,
  template: BoardTemplate,
  frequencies: ReadonlyMap<string, number>,
  sampling: ProfileSampling = defaultSampling,
  englishVocabulary?: EnglishProfileVocabulary,
) {
  const difficulty = createWordDifficulty(lexicon, frequencies);
  const vocabulary = wordFrequencyLanguage(template.rules) === "en" ? englishVocabulary : undefined;
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
      difficulty?: number;
      study?: number;
    }
  >();
  function wordData(word: string, policy: PlayerProfile) {
    const spelling = word.toUpperCase();
    let wordInfo = wordCache.get(spelling);
    if (!wordInfo) {
      wordInfo = {
        hash: profileWordHash(spelling),
        data: {},
      };
      wordCache.set(spelling, wordInfo);
    }
    const cached = wordInfo.data[policy];
    if (cached) return cached;
    if (vocabulary && usesLearnerPolicy(policy)) {
      const entry = vocabulary.get(spelling);
      const chance = policy === "casual"
        ? casualWordProbability(spelling, entry)
        : learnerWordProbability(spelling, entry);
      return (wordInfo.data[policy] = {
        hash: wordInfo.hash,
        knowledge: chance * scale,
        recall: 1,
      });
    }
    const model = policy === "strong" ? "strong" : "learner";
    const preset = presets[model];
    const study = preset.study
      ? (wordInfo.study ??= studyPriority(spelling))
      : 0;
    const baseDifficulty = (wordInfo.difficulty ??= difficulty(spelling).difficulty);
    const adjusted = baseDifficulty * (1 - preset.study * study);
    return (wordInfo.data[model] = {
      hash: wordInfo.hash,
      knowledge:
        Math.min(
          Math.exp(-0.72 * preset.vocabulary * adjusted),
          spelling.length === 2 ? preset.shortWords : 1,
        ) * scale,
      recall: Math.exp(-0.28 * preset.vocabulary * adjusted),
    });
  }

  function knownWordDifficulty(word: string) {
    const spelling = word.toUpperCase();
    const wordInfo = wordCache.get(spelling)!;
    return (wordInfo.difficulty ??= difficulty(spelling).difficulty);
  }

  const { size, premiums } = template;
  const lengthChance = Object.fromEntries(
    models.map((profile) => [
      profile,
      Array.from(
        { length: template.rackSize + 1 },
        (_, tiles) => presets[profile].bingo ** (Math.max(0, tiles - 5) / 2),
      ),
    ]),
  ) as Record<Model, number[]>;
  const blankChance = Object.fromEntries(
    models.map((profile) => [
      profile,
      Array.from(
        { length: template.rackSize + 1 },
        (_, blanks) => presets[profile].blank ** blanks
          * presets[profile].secondBlank ** Math.max(0, blanks - 1),
      ),
    ]),
  ) as Record<Model, number[]>;
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
  let rackOutCheck: ReturnType<typeof createProfileRackOut> | undefined;

  return (
    moves: readonly Move[],
    profile: PlayerProfile,
    position: ProfilePosition,
    options: {
      all?: boolean;
      topThree?: boolean;
      metrics?: boolean;
      learnerSlate?: boolean;
    } = {},
  ): ProfileDecision => {
    if (!moves.length)
      return { bingoFound: false, considered: options.all ? [] : undefined };
    const model = profile === "strong" ? "strong" : "learner";
    const vocabularyPolicy = vocabulary ? profile : model;
    const preset = presets[model];
    const halfLife = usesLearnerPolicy(profile) ? LEARNER_HALF_LIFE[profile] : undefined;
    const isLearner = halfLife !== undefined;
    const liveLearner = isLearner && options.learnerSlate;
    const appealFor = isLearner
      ? (value: number) => learnerLogAppeal(value, halfLife)
      : (value: number) => profileAppeal(value, sampling.appeal);
    const selectionWeight = (visibility: number, appeal: number) =>
      isLearner ? Math.log(visibility) + appeal : visibility * appeal;
    const { bagSize, board, seed, playerSeed, rack, solo, scorelessTurns, scoreSpread } =
      position;
    const emptyBag = bagSize === 0 && template.rules !== "crossplay";
    const familiarityWeight = preset.lateFamiliarity
      * lateProfileFamiliarityWeight(bagSize, template.rackSize);
    // Give Learner more credit for the whole leave while there are tiles to draw.
    const learnerLeaveBoost =
      isLearner ? Math.min(1, bagSize / template.rackSize) : 0;
    const pool =
      !solo && emptyBag && (profile === "strong" || liveLearner)
        ? unseenTiles(position, template)
        : undefined;
    const canTrack =
      pool && !pool.excess.length && pool.total <= template.rackSize;
    const opponent = liveLearner && canTrack ? endgameOpponentRack(pool, template.rackSize) : undefined;
    const planEndgame =
      profile === "strong" &&
      canTrack &&
      scorelessTurns !== undefined &&
      pool.total > 0 &&
      rack.replaceAll(".", "").length + pool.total <= PROFILE_ENDGAME_TILES;
    const shortlistSize =
      !solo && (bagSize > 0 || planEndgame) ? preset.finalists : 1;
    type Candidate = LearnerCandidate & { weight: number; utility?: ProfileUtility };
    const shortlist: Candidate[] = [];
    const candidates: Candidate[] = [];
    const knownWords = new Map<WordProfile, boolean>();
    const leaveScores = new Map<string, number>();
    const rackOut = canTrack
      ? 2 * pool.tiles.reduce((sum, tile) => sum + tile.count * tile.score, 0)
      : emptyBag
        ? preset.finish
        : 0;
    let bingoFound = false;
    let withoutLeave: Move | undefined;
    let bestBase = -Infinity;
    let topReason: ProfileDecision["topReason"];
    const rawFirst = options.metrics ? moves[0].id : undefined;

    function knows(data: WordProfile) {
      if (data.knowledge === scale) return true;
      let result = knownWords.get(data);
      if (result === undefined) {
        result = mixProfileSeed(data.hash ^ playerSeed) < data.knowledge;
        knownWords.set(data, result);
      }
      return result;
    }

    function knowsMove(move: Move) {
      return knows(wordData(move.word, vocabularyPolicy)) &&
        move.crosses.every((cross) => knows(wordData(cross, vocabularyPolicy)));
    }

    const selected = profileAttention(
      board,
      size,
      neighbors,
      salience,
      preset.focus * sampling.coverage,
      preset.hookAttention,
      seed,
      liveLearner
        ? () => learnerRackCues(board, template, splitRack(position).available,
            (spelling) => lexicon.has(spelling) && knows(wordData(spelling, vocabularyPolicy)))
        : undefined,
    );
    const crossVisibility = Math.exp(-preset.cross);
    for (const move of moves) {
      const reject = (reason: ProfileDecision["topReason"]) => {
        if (move.id === rawFirst) topReason = reason;
      };
      if (selected && !move.tiles.some(({ index }) => selected[index])) {
        reject("placement");
        continue;
      }
      const word = wordData(move.word, vocabularyPolicy);
      if (!knowsMove(move)) {
        reject("vocabulary");
        continue;
      }
      const long = move.tiles.length > 5;
      // Reuse the long-placement recall roll. A bingo bonus can sway a player
      // only after they've found how to use that many of their tiles.
      if (
        long &&
        mixProfileSeed(word.hash ^ seed) >=
          scale *
            lengthChance[model][move.tiles.length] *
            blankChance[model][move.blanks]
      ) {
        reject("recall");
        continue;
      }
      const first = move.row * size + move.col;
      const last =
        first +
        (move.word.length - 1) * (move.direction === "across" ? 1 : size);
      const simpleExtension =
        move.tiles.length === 1 &&
        move.word.length >= 3 &&
        !move.blanks &&
        (move.tiles[0].index === first || move.tiles[0].index === last);
      const recall = simpleExtension
        ? 1
        : word.recall *
          (long ? 1 : blankChance[model][move.blanks]) *
          (move.direction === "down" && move.word.length > 2
            ? preset.vertical
            : 1);
      let familiarity = 1;
      if (familiarityWeight) {
        let hardest = knownWordDifficulty(move.word);
        for (const cross of move.crosses)
          hardest = Math.max(hardest, knownWordDifficulty(cross));
        familiarity = Math.exp(-familiarityWeight * hardest);
      }
      const visibility = recall * crossVisibility ** move.crosses.length * familiarity;
      reject("found");
      bingoFound ||= isBingo(template, move.tiles.length);
      let premium = 0;
      if (preset.premium)
        for (const tile of move.tiles)
          premium = Math.max(premium, salience[tile.index]);
      const confirmedOut = !!opponent && !move.leave;
      const points = confirmedOut ? move.score : preset.score * move.score;
      const premiumBonus = confirmedOut ? 0 : preset.premium * premium;
      const base = points + premiumBonus;
      if (options.metrics && base > bestBase) {
        bestBase = base;
        withoutLeave = move;
      }
      let leave = 0;
      const goingOut = emptyBag && !move.leave ? rackOut : 0;
      if (bagSize || emptyBag) {
        let estimate = leaveScores.get(move.leave);
        if (estimate === undefined) {
          if (emptyBag) {
            estimate = -preset.endRack * rackPoints(move.leave, template.rules);
          } else {
            const quality = profileLeaveValue(move.leave);
            estimate = preset.leave * (quality + learnerLeaveBoost * (0.75 * quality));
          }
          leaveScores.set(move.leave, estimate);
        }
        leave = estimate;
      }
      const value = base + leave + goingOut;
      const appeal = appealFor(value);
      const entry: Candidate = {
        move,
        value,
        visibility,
        weight: selectionWeight(visibility, appeal),
      };
      if (options.all)
        entry.utility = {
          total: value,
          points,
          premium: premiumBonus,
          visibility,
          appeal: isLearner ? learnerAppeal(value, halfLife) : appeal,
          leave,
          goingOut,
        };
      candidates.push(entry);
      // Skip shortlist work for a picker that won't check tactics or report metrics.
      if (shortlistSize === 1 && !options.metrics) continue;
      const priority = planEndgame ? value : entry.weight;
      if (shortlist.length === shortlistSize) {
        const last = shortlist[shortlist.length - 1];
        if (priority <= (planEndgame ? last.value : last.weight)) continue;
      }
      // Immediate rack-outs have the same continuation. Only the best needs a solve.
      if (planEndgame && !move.leave) {
        const existing = shortlist.findIndex((item) => !item.move.leave);
        if (existing >= 0) {
          if (value <= shortlist[existing].value) continue;
          shortlist.splice(existing, 1);
        }
      } else if (!planEndgame) {
        // Equivalent placements of one spelling shouldn't occupy the whole shortlist.
        const existing = shortlist.findIndex(
          (item) => item.move.word === move.word,
        );
        if (existing >= 0) {
          if (entry.weight <= shortlist[existing].weight) continue;
          shortlist.splice(existing, 1);
        }
      }
      const slot = shortlist.findIndex(
        (item) => priority > (planEndgame ? item.value : item.weight),
      );
      if (slot >= 0) shortlist.splice(slot, 0, entry);
      else if (shortlist.length < shortlistSize) shortlist.push(entry);
      if (shortlist.length > shortlistSize) shortlist.pop();
    }

    function updateAppeal(entry: Candidate) {
      const appeal = appealFor(entry.value);
      entry.weight = selectionWeight(entry.visibility, appeal);
      if (entry.utility) {
        entry.utility.total = entry.value;
        entry.utility.appeal = isLearner ? learnerAppeal(entry.value, halfLife) : appeal;
      }
    }

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
        }
        updateAppeal(entry);
      }
    } else if (planEndgame && shortlist.length > 1) {
      const spreads = (endgame ??= createProfileEndgame(lexicon, template))(
        board,
        pool,
        scorelessTurns,
        shortlist.map(({ move }) => move),
      );
      if (spreads) {
        for (const [index, entry] of shortlist.entries()) {
          const leave =
            -preset.endRack * rackPoints(entry.move.leave, template.rules);
          const goingOut = entry.move.leave ? 0 : rackOut;
          // Replace the static rack projection with the spread from the line.
          const adjustment =
            spreads[index] - entry.move.score - leave - goingOut;
          entry.value += adjustment;
          if (entry.utility) entry.utility.endgame = adjustment;
          updateAppeal(entry);
        }
      }
    }
    const compareLearner = liveLearner && !solo && bagSize > 0;
    const comparisonLimit = profile === "learner" || emptyBag ? 6 : 3;
    const limit = options.all
      ? candidates.length
      : compareLearner || opponent
        ? comparisonLimit
        : options.topThree ? 3 : 1;
    let order = sampleProfilePlacements(candidates, seed, limit, isLearner);
    if (opponent && halfLife !== undefined) {
      const focusedOut = moves.reduce<Move | undefined>((best, move) =>
        !move.leave && (!best || move.score > best.score) && knowsMove(move) ? move : best, undefined);
      let finishing = focusedOut && order.find(({ move }) => move.id === focusedOut.id);
      if (focusedOut && !finishing) {
        const value = focusedOut.score + rackOut;
        const appeal = appealFor(value);
        finishing = { move: focusedOut, value, visibility: 1, weight: selectionWeight(1, appeal) };
        if (options.all) finishing.utility = {
          total: value, points: focusedOut.score, premium: 0, visibility: 1,
          appeal: learnerAppeal(value, halfLife), leave: 0, goingOut: rackOut,
        };
      }
      const slate = new Map<string, Candidate>();
      for (const entry of order) {
        if (!slate.has(entry.move.word)) slate.set(entry.move.word, entry);
        if (slate.size === comparisonLimit) break;
      }
      const finalists = [...slate.values()];
      if (finishing && !finalists.includes(finishing)) finalists.push(finishing);
      if (finishing && scoreSpread !== undefined && scoreSpread + finishing.value > 0) {
        if (finishing.utility) finishing.utility.selection = "winning-rack-out";
        order = [finishing, ...order.filter(({ move }) => move.id !== finishing.move.id)];
      } else if (finishing || scoreSpread !== undefined) {
        const outcomes = (rackOutCheck ??= createProfileRackOut(lexicon, template))(
          board, opponent, finalists.map(({ move }) => move), knowsMove,
          rackOut, preset.endRack, scoreSpread, scorelessTurns,
        );
        if (outcomes) {
          const byMove = new Map(finalists.map((entry) => [entry.move.id, entry]));
          const ranked = outcomes.map(({ move, value, priority }) => {
            const entry = byMove.get(move.id)!;
            if (priority !== 0 && move.leave) {
              if (entry.utility) entry.utility.endgame = value - entry.value;
              entry.value = value;
              updateAppeal(entry);
            }
            return entry;
          });
          if (ranked[0]?.utility) ranked[0].utility.selection = "known-rack";
          order = [...ranked, ...order.filter(({ move }) => !byMove.has(move.id))];
        }
      }
      if (finishing && order[0]?.move.id === finishing.move.id) {
        bingoFound ||= isBingo(template, finishing.move.tiles.length);
        if (rawFirst === finishing.move.id) topReason = "found";
      }
    }
    const first = order[0];
    const move = first?.move;
    let learnerSlate: Candidate[] | undefined;
    if (compareLearner && first) {
      learnerSlate = [];
      for (const entry of order.slice(0, comparisonLimit))
        if (!learnerSlate.some(({ move }) => move.word === entry.move.word))
          learnerSlate.push(entry);
    }
    if (topReason === "found" && move?.id !== rawFirst) topReason = "rank";
    return {
      move,
      bingoFound,
      learnerSlate,
      considered: options.all
        ? order.map(({ move, utility }) => ({ move, utility: utility! }))
        : undefined,
      suggestions: options.topThree
        ? order.slice(0, 3).map(({ move }) => move)
        : undefined,
      visibleIdeas: options.metrics
        ? new Set(candidates.map(({ move }) => move.word)).size
        : undefined,
      withoutLeave,
      beforeDefense,
      topReason,
    };
  };
}

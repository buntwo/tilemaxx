import { type Lexicon } from "./lexicon";
import {
  isBingo,
  minimumBingoTiles,
  type Board,
  type BoardTemplate,
  type Move,
  type Placement,
  type Position,
} from "./model";
import { rackLetters } from "./rack-entry";
import { SEARCH_LIMITS, SearchLimitError, prepareSolver } from "./solver";
import { unseenTiles } from "./tile-pool";
import { solveEmptyBag, type EndgameLine } from "./endgame";

export const ANALYSIS_LIMIT = 3;
export const ANALYSIS_TRIALS = 200;
export const REFINED_TRIALS = 800;
export type OpponentModel = "strong" | "casual";
const MODELS = ["strong", "casual"] as const;

export interface AnalysisRequest extends Position {
  template: BoardTemplate;
  candidates: Move[];
  bagSize: number;
  trials: number;
  seed: number;
  previousBoard?: Board;
  scorelessTurns?: number;
}
export interface ReplyForecast {
  replyScore: number;
  bigReply: number;
  nextBingo: number;
  nextScore: number;
  swing: number;
  example: Move | null;
}
export interface MoveForecast {
  move: Move;
  drawSize: number;
  bingo: number;
  exact: boolean;
  bingoDraws: string[];
  bigAvailable: number;
  bingoAvailable: number;
  bestReply: number;
  availableExample: Move | null;
  bigThreatRemoved: number;
  bigThreatOpened: number;
  models: Record<OpponentModel, ReplyForecast>;
  endgame?: EndgameLine | null;
}
export interface AnalysisResult {
  trials: number;
  target: number;
  bagSize: number;
  opponentRackSize: number;
  effectiveTrials: number;
  inferred: boolean;
  forecasts: MoveForecast[];
}

export interface AnalysisProgress {
  phase: "draws" | "scenarios" | "endgames";
  completed: number;
  total: number;
}

export function placeTiles(board: Board, move: Move): Board {
  const next = [...board];
  for (const { index, letter } of move.tiles) next[index] = letter;
  return next;
}

export function addedTiles(
  previous: Board,
  board: Board,
  rackSize: number,
): Placement[] {
  if (previous.length !== board.length) return [];
  const added: Placement[] = [];
  for (let index = 0; index < board.length; index++) {
    if (previous[index] === board[index]) continue;
    if (previous[index] || !board[index]) return [];
    added.push({ index, letter: board[index] });
  }
  return added.length <= rackSize ? added : [];
}

/** Approximate point value of a leave, for ranking moves before simulation. */
export function leaveValue(leave: string): number {
  let value = 0,
    vowels = 0,
    consonants = 0;
  const used = new Set<string>();
  for (const letter of leave) {
    if (letter === "?") {
      value += 12;
      continue;
    }
    if ("AEIOU".includes(letter)) vowels++;
    else consonants++;
    if (used.has(letter)) value -= 2;
    used.add(letter);
    if (letter === "S") value += 5;
    else if ("AERNT".includes(letter)) value += 1;
    else if ("QVW".includes(letter)) value -= 3;
    else if ("JUXZ".includes(letter)) value -= 1;
  }
  return value - 1.4 * Math.max(0, Math.abs(vowels - consonants) - 1);
}

export function bestStrongReply(moves: Move[], bagSize: number): Move | null {
  let best: Move | null = null,
    bestValue = -Infinity;
  for (const move of moves) {
    const value = move.score + (bagSize ? leaveValue(move.leave) : 0);
    if (value > bestValue) {
      best = move;
      bestValue = value;
    }
  }
  return best;
}

export function bestReply(
  moves: Move[],
  model: OpponentModel,
  familiar: ReadonlySet<string>,
  random: number,
  bagSize: number,
): Move | null {
  if (model === "strong") return bestStrongReply(moves, bagSize);

  // A casual player favors familiar words and chooses among a few strong
  // candidates. Keep one placement per word in that shortlist.
  const shortlist: { move: Move; value: number }[] = [];
  for (const move of moves) {
    const known =
      isFamiliar(move.word, familiar) &&
      move.crosses.every((word) => isFamiliar(word, familiar));
    const value =
      move.score - (known ? 0 : 18) - Math.max(0, move.word.length - 5);
    const sameWord = shortlist.findIndex(
      (entry) => entry.move.word === move.word,
    );
    if (sameWord >= 0 && shortlist[sameWord].value >= value) continue;
    if (sameWord >= 0) shortlist.splice(sameWord, 1);
    const ahead = shortlist.findIndex((entry) => value > entry.value);
    if (ahead === -1) {
      if (shortlist.length < 3) shortlist.push({ move, value });
    } else {
      shortlist.splice(ahead, 0, { move, value });
      if (shortlist.length > 3) shortlist.pop();
    }
  }
  const index = random < 0.65 ? 0 : random < 0.9 ? 1 : 2;
  return shortlist[Math.min(index, shortlist.length - 1)]?.move ?? null;
}

function isFamiliar(word: string, familiar: ReadonlySet<string>) {
  if (familiar.has(word)) return true;
  if (word.length < 4) return false;
  return ["S", "ES", "ED", "ING"].some((ending) => {
    if (!word.endsWith(ending)) return false;
    const stem = word.slice(0, -ending.length);
    return stem.length >= 2 && (familiar.has(stem) || familiar.has(stem + "E"));
  });
}

export function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Ordered physical draws without replacement. A prefix can be reused by each candidate. */
export function sampleTiles(
  pool: readonly string[],
  length: number,
  random: () => number,
) {
  const available = [...pool];
  for (let i = 0; i < length; i++) {
    const j = i + Math.floor(random() * (available.length - i));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available.slice(0, length).join("");
}

export function weightedDraws(pool: readonly string[], drawSize: number) {
  if (drawSize === 0) return [{ draw: "", weight: 1 }];
  const counts = new Map<string, number>();
  for (const tile of pool) counts.set(tile, (counts.get(tile) ?? 0) + 1);
  const entries = [...counts.entries()];
  if (drawSize === 1)
    return entries.map(([draw, weight]) => ({ draw, weight }));
  if (drawSize !== 2)
    throw new Error("Exact analysis supports at most two draws.");
  const draws: { draw: string; weight: number }[] = [];
  entries.forEach(([a, countA], i) => {
    for (const [b, countB] of entries.slice(i)) {
      const weight = a === b ? (countA * (countA - 1)) / 2 : countA * countB;
      if (weight) draws.push({ draw: a + b, weight });
    }
  });
  return draws;
}

function replyTotals() {
  return {
    score: 0,
    big: 0,
    nextBingo: 0,
    nextScore: 0,
    examples: new Map<string, { move: Move; count: number }>(),
  };
}
type ReplyTotals = ReturnType<typeof replyTotals>;

function recordReply(
  totals: ReplyTotals,
  reply: Move | null,
  nextBingo: boolean,
  nextScore: number,
  weight: number,
) {
  const score = reply?.score ?? 0;
  totals.score += weight * score;
  totals.big += weight * Number(score >= 40);
  totals.nextBingo += weight * Number(nextBingo);
  totals.nextScore += weight * nextScore;
  if (!reply || score < 40) return;
  const entry = totals.examples.get(reply.id);
  if (entry) entry.count += weight;
  else totals.examples.set(reply.id, { move: reply, count: weight });
}

export function analyzeMoves(
  lexicon: Lexicon,
  request: AnalysisRequest,
  familiar: ReadonlySet<string>,
  progress: (update: AnalysisProgress) => void = () => {},
  maxMs = request.trials > ANALYSIS_TRIALS ? 12_000 : 8_000,
): AnalysisResult {
  const { board, rack, template, candidates, bagSize, trials, seed } = request;
  const unseen = unseenTiles({ board, rack }, template);
  if (unseen.excess.length)
    throw new Error(
      "Check the board and rack. Some entered tiles exceed the starting counts.",
    );
  if (!candidates.length || candidates.length > ANALYSIS_LIMIT)
    throw new Error("Choose one to three moves.");
  const opponentRackSize = unseen.total - bagSize;
  if (
    !Number.isInteger(bagSize) ||
    bagSize < 0 ||
    opponentRackSize < 0 ||
    opponentRackSize > template.rackSize
  ) {
    throw new Error(
      "Check the bag count. The other unseen tiles must fit on one opponent’s rack.",
    );
  }
  if (!Number.isInteger(trials) || trials < 1 || trials > REFINED_TRIALS)
    throw new Error("Invalid number of trials.");
  if (
    request.scorelessTurns !== undefined &&
    (!Number.isInteger(request.scorelessTurns) ||
      request.scorelessTurns < 0 ||
      request.scorelessTurns > 5)
  ) {
    throw new Error("Enter zero to five prior scoreless turns.");
  }

  const pool = unseen.tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  const deadline = performance.now() + maxMs;
  const bingoTiles = minimumBingoTiles(template);
  const crossplay = template.rules === "crossplay";
  // The boards used by analysis are immutable snapshots.
  const prepared = new WeakMap<Board, ReturnType<typeof prepareSolver>>();
  function prepare(position: Board, until: number) {
    const deadline = Math.min(until, performance.now() + SEARCH_LIMITS.maxMs);
    if (performance.now() >= deadline) throw new SearchLimitError();
    let solver = prepared.get(position);
    if (!solver) {
      solver = prepareSolver(lexicon, position, template);
      prepared.set(position, solver);
    }
    const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
    if (maxMs <= 0) throw new SearchLimitError();
    return { solver, limits: { maxMs } };
  }
  function search(
    position: Board,
    letters: string,
    until: number,
    bingoOnly = false,
  ) {
    if (!letters || (bingoOnly && letters.length < bingoTiles)) return [];
    const { solver, limits } = prepare(position, until);
    return solver.solve(letters, limits, { bingoOnly, unsorted: true });
  }
  function summarize(position: Board, rack: string) {
    if (!rack) return { score: 0, bingo: false };
    const { solver, limits } = prepare(position, deadline);
    return solver.summarize(rack, limits);
  }

  const previous = request.previousBoard;
  let inferWeight: ((opponent: string) => number) | undefined;
  if (previous && bagSize > 0 && opponentRackSize === template.rackSize) {
    const added = addedTiles(previous, board, template.rackSize);
    const played = added
      .map(({ letter }) => (letter === letter.toUpperCase() ? letter : "?"))
      .join("");
    const id = added
      .map(({ index, letter }) => `${index}:${letter}`)
      .sort()
      .join(",");
    const recorded = search(previous, played, deadline).find(
      (move) => move.id === id,
    );
    if (!recorded)
      throw new Error(
        "The last board edit does not match one legal opponent play.",
      );
    const weights = new Map<string, number>();
    inferWeight = (opponent) => {
      // The sampled rack starts with the opponent's old leave, followed
      // by their refill. Draws from the remaining pool go to our player.
      const leave = [...opponent.slice(0, template.rackSize - played.length)]
        .sort()
        .join("");
      const cached = weights.get(leave);
      if (cached !== undefined) return cached;
      const observed = recorded.score + leaveValue(leave);
      let best = observed;
      for (const move of search(previous, leave + played, deadline)) {
        best = Math.max(best, move.score + leaveValue(move.leave));
      }
      const weight = Math.exp(-(best - observed) / 12);
      weights.set(leave, weight);
      return weight;
    };
  }

  const entries = candidates.map((move) => {
    const leave = rackLetters(move.leave);
    return {
      move,
      leave,
      board: placeTiles(board, move),
      drawSize: Math.min(bagSize, template.rackSize - leave.length),
      goesOut: !crossplay && bagSize === 0 && leave.length === 0,
      exact: null as { bingo: number; draws: string[] } | null,
      bingo: 0,
      bingoDraws: new Map<string, number>(),
      bigAvailable: 0,
      bingoAvailable: 0,
      bestReply: 0,
      availableExamples: new Map<string, { move: Move; count: number }>(),
      bigThreatRemoved: 0,
      bigThreatOpened: 0,
      models: { strong: replyTotals(), casual: replyTotals() },
      knownReplies: undefined as Move[] | undefined,
      knownFollowups: new Map<string, { bingo: boolean; score: number }>(),
      replyBoards: new Map<string, Board>(),
    };
  });

  // Reserve most of the time for complete paired trials. Fall back to
  // sampling if an exact pass hits its budget.
  const exactDeadline = Math.min(deadline, performance.now() + maxMs * 0.25);
  const drawLists = entries.map((entry) =>
    !inferWeight &&
    entry.drawSize <= 2 &&
    !entry.goesOut &&
    entry.leave.length + entry.drawSize >= bingoTiles
      ? weightedDraws(pool, entry.drawSize)
      : [],
  );
  const drawTotal = drawLists.reduce((sum, list) => sum + list.length, 0);
  let drawsChecked = 0;
  if (drawTotal) progress({ phase: "draws", completed: 0, total: drawTotal });
  for (const [i, entry] of entries.entries()) {
    if (entry.leave.length + entry.drawSize < bingoTiles || entry.goesOut) {
      entry.exact = { bingo: 0, draws: [] };
      continue;
    }
    if (!drawLists[i].length) continue;
    try {
      let hits = 0,
        weight = 0;
      const examples: { draw: string; weight: number }[] = [];
      for (const draw of drawLists[i]) {
        weight += draw.weight;
        if (
          search(entry.board, entry.leave + draw.draw, exactDeadline, true)
            .length
        ) {
          hits += draw.weight;
          if (draw.draw) examples.push(draw);
        }
        drawsChecked++;
        if (drawsChecked % 10 === 0 || drawsChecked === drawTotal) {
          progress({
            phase: "draws",
            completed: drawsChecked,
            total: drawTotal,
          });
        }
      }
      examples.sort(
        (a, b) => b.weight - a.weight || a.draw.localeCompare(b.draw),
      );
      entry.exact = {
        bingo: hits / weight,
        draws: examples.slice(0, 6).map(({ draw }) => draw),
      };
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
    }
  }

  const random = randomGenerator(seed);
  const maxDraw = Math.max(...entries.map(({ drawSize }) => drawSize));
  let completed = 0;
  let totalWeight = 0,
    totalSquaredWeight = 0;
  progress({ phase: "scenarios", completed: 0, total: trials });
  for (; completed < trials; completed++) {
    const order = sampleTiles(pool, opponentRackSize + maxDraw, random);
    const opponent = order.slice(0, opponentRackSize);
    const bag = order.slice(opponentRackSize);
    const choice = random();
    try {
      if (performance.now() >= deadline) throw new SearchLimitError();
      const weight = inferWeight?.(opponent) ?? 1;
      const outcomes = entries.map((entry) => {
        const draw = bag.slice(0, entry.drawSize);
        const refill = entry.leave + draw;
        const bagAfter = bagSize - entry.drawSize;
        const replies =
          entry.knownReplies ??
          (entry.goesOut ? [] : search(entry.board, opponent, deadline));
        if (!bagSize) entry.knownReplies = replies;
        let strongest: Move | null = null,
          replyBingo = false;
        for (const reply of replies) {
          if (!strongest || reply.score > strongest.score) strongest = reply;
          replyBingo ||= isBingo(template, reply.tiles.length);
        }
        const bingo =
          !entry.exact && !!search(entry.board, refill, deadline, true).length;
        const forecasts = bagSize
          ? new Map<string, { bingo: boolean; score: number }>()
          : entry.knownFollowups;
        const models = MODELS.map((model) => {
          const reply = bestReply(replies, model, familiar, choice, bagAfter);
          const key = reply?.id ?? "";
          let forecast = forecasts.get(key);
          if (!forecast) {
            const opponentWentOut =
              !crossplay && !!reply && !bagAfter && !reply.leave;
            if (entry.goesOut || opponentWentOut || (crossplay && !bagSize)) {
              forecast = { score: 0, bingo: false };
            } else {
              let position = entry.board;
              if (reply) {
                position =
                  entry.replyBoards.get(key) ?? placeTiles(entry.board, reply);
                // Refresh the entry so frequently seen replies keep their compiled board.
                entry.replyBoards.delete(key);
                entry.replyBoards.set(key, position);
                if (entry.replyBoards.size > 32) {
                  entry.replyBoards.delete(
                    entry.replyBoards.keys().next().value!,
                  );
                }
              }
              forecast = summarize(position, refill);
            }
            forecasts.set(key, forecast);
          }
          return { model, reply, ...forecast };
        });
        return {
          draw,
          high: strongest?.score ?? 0,
          strongest,
          replyBingo,
          bingo,
          models,
        };
      });
      // Count a trial only after every candidate has finished it.
      totalWeight += weight;
      totalSquaredWeight += weight * weight;
      const referenceThreat = outcomes[0].high >= 40;
      outcomes.forEach(
        ({ draw, high, strongest, replyBingo, bingo, models }, index) => {
          const entry = entries[index];
          const big = high >= 40;
          entry.bigAvailable += weight * Number(big);
          entry.bingoAvailable += weight * Number(replyBingo);
          entry.bestReply += weight * high;
          entry.bigThreatRemoved += weight * Number(referenceThreat && !big);
          entry.bigThreatOpened += weight * Number(!referenceThreat && big);
          entry.bingo += weight * Number(bingo);
          if (big && strongest) {
            const example = entry.availableExamples.get(strongest.id);
            if (example) example.count += weight;
            else
              entry.availableExamples.set(strongest.id, {
                move: strongest,
                count: weight,
              });
          }
          if (bingo && draw) {
            const key = [...draw].sort().join("");
            entry.bingoDraws.set(
              key,
              (entry.bingoDraws.get(key) ?? 0) + weight,
            );
          }
          for (const result of models)
            recordReply(
              entry.models[result.model],
              result.reply,
              result.bingo,
              result.score,
              weight,
            );
        },
      );
      if ((completed + 1) % 10 === 0 || completed + 1 === trials) {
        progress({
          phase: "scenarios",
          completed: completed + 1,
          total: trials,
        });
      }
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      break;
    }
  }
  if (!completed)
    throw new Error(
      "This position hit the analysis limit. Try comparing fewer moves.",
    );
  if (!totalWeight)
    throw new Error(
      "The last-play model assigned too little weight to these samples.",
    );
  const searchEndgames =
    !bagSize && template.rules === "scrabble" && opponentRackSize > 0;
  if (searchEndgames)
    progress({ phase: "endgames", completed: 0, total: entries.length });
  return {
    trials: completed,
    target: trials,
    bagSize,
    opponentRackSize,
    effectiveTrials: totalWeight ** 2 / totalSquaredWeight,
    inferred: !!inferWeight,
    forecasts: entries.map((entry, index) => {
      function forecast(totals: ReplyTotals): ReplyForecast {
        const example = [...totals.examples.values()].sort(
          (a, b) => b.count - a.count || b.move.score - a.move.score,
        )[0];
        return {
          replyScore: totals.score / totalWeight,
          bigReply: totals.big / totalWeight,
          nextBingo: totals.nextBingo / totalWeight,
          nextScore: totals.nextScore / totalWeight,
          swing:
            entry.move.score + (totals.nextScore - totals.score) / totalWeight,
          example: example?.move ?? null,
        };
      }
      let endgame: EndgameLine | null | undefined;
      if (searchEndgames) {
        const endgameDeadline = performance.now() + 1_500 / entries.length;
        try {
          endgame = solveEmptyBag(
            board,
            entry.move,
            pool.join(""),
            template,
            request.scorelessTurns ?? 0,
            (position, letters) => search(position, letters, endgameDeadline),
            placeTiles,
          );
        } catch (error) {
          if (!(error instanceof SearchLimitError)) throw error;
          endgame = null;
        }
        progress({
          phase: "endgames",
          completed: index + 1,
          total: entries.length,
        });
      }
      return {
        move: entry.move,
        endgame,
        drawSize: entry.drawSize,
        bingo: entry.exact?.bingo ?? entry.bingo / totalWeight,
        exact: entry.exact !== null,
        bingoDraws:
          entry.exact?.draws ??
          [...entry.bingoDraws]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([draw]) => draw),
        bigAvailable: entry.bigAvailable / totalWeight,
        bingoAvailable: entry.bingoAvailable / totalWeight,
        bestReply: entry.bestReply / totalWeight,
        availableExample:
          [...entry.availableExamples.values()].sort(
            (a, b) => b.count - a.count || b.move.score - a.move.score,
          )[0]?.move ?? null,
        bigThreatRemoved: entry.bigThreatRemoved / totalWeight,
        bigThreatOpened: entry.bigThreatOpened / totalWeight,
        models: {
          strong: forecast(entry.models.strong),
          casual: forecast(entry.models.casual),
        },
      };
    }),
  };
}

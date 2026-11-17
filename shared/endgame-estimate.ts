import {
  crossplayFinalRound,
  endgameStreaks,
  nextEndgameStreak,
  rackPoints,
} from "./endgame";
import { pruneEndgameDictionary } from "./endgame-dictionary";
import type { Lexicon } from "./lexicon";
import type { Board, Move } from "./model";
import { rackLetters } from "./rack-entry";
import { replyPosition, type ReplyPosition } from "./reply-analysis";
import { createSolverFactory, SearchLimitError, SEARCH_LIMITS } from "./solver";

export interface EndgameEstimate {
  spread: number;
  exact: boolean;
  reply?: { word: string; score: number; goesOut: boolean };
}

const BEAM_WIDTH = 4;
const PLIES = 7;

/** One fixed-depth, narrow minimax pass. Omitted moves make beam results
 * approximate, even when every selected branch reaches a terminal position.
 */
export function prepareEndgameEstimate(
  lexicon: Lexicon,
  position: ReplyPosition,
  preparationDeadline = Infinity,
) {
  const {
    board,
    template,
    scorelessTurns,
    opponentHasFinalTurn = true,
  } = position;
  const { bagSize, pool } = replyPosition(position);
  if (bagSize) throw new Error("Endgame estimates require an empty bag.");
  const rule = endgameStreaks[template.rules];
  const opponent = pool.join("");
  const dictionary = rule
    ? pruneEndgameDictionary(
        lexicon,
        board,
        template.size,
        rackLetters(position.rack) + opponent,
        Math.min(preparationDeadline, performance.now() + 500),
      )
    : lexicon;
  const prepare = createSolverFactory(dictionary, template, true);
  const compiled = new WeakMap<Board, ReturnType<typeof prepare>>();
  const points = new Map<string, number>();
  function value(rack: string) {
    let score = points.get(rack);
    if (score === undefined) {
      score = rackPoints(rack, template.rules);
      points.set(rack, score);
    }
    return score;
  }
  function check(deadline: number) {
    if (performance.now() >= deadline) throw new SearchLimitError("time");
  }
  function search(board: Board, rack: string, deadline: number) {
    check(deadline);
    if (rack.length === 1) return prepare.singleMoves(board, rack);
    let solver = compiled.get(board);
    if (!solver) {
      solver = prepare(board);
      compiled.set(board, solver);
    }
    const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
    if (maxMs <= 0) throw new SearchLimitError("time");
    return solver.solve(rack, { maxMs }, { unsorted: true });
  }
  function describe(move: Move | null) {
    return move
      ? { word: move.word, score: move.score, goesOut: !move.leave }
      : undefined;
  }
  // Select four moves without sorting a potentially large generated list.
  // Terminal moves share the same rack transfer: only the highest score matters.
  function select(moves: Move[]): (Move | null)[] {
    const top: Move[] = [];
    let out: Move | undefined,
      outCount = 0;
    const priority = (move: Move) => move.score + 5 * move.tiles.length;
    for (const move of moves) {
      if (!move.leave) {
        outCount++;
        if (!out || move.score > out.score) out = move;
        continue;
      }
      let i = 0;
      while (i < top.length && priority(top[i]) >= priority(move)) i++;
      if (i < BEAM_WIDTH) {
        top.splice(i, 0, move);
        if (top.length > BEAM_WIDTH) top.pop();
      }
    }
    const selected: (Move | null)[] = out ? [out] : [];
    selected.push(...top.slice(0, Math.max(0, BEAM_WIDTH - outCount)), null);
    return selected;
  }
  function turn(
    board: Board,
    own: string,
    other: string,
    streak: number,
    depth: number,
    alpha: number,
    beta: number,
    deadline: number,
    moves?: Move[],
  ): { value: number; best: Move | null } {
    check(deadline);
    if (streak >= rule!.limit || depth <= 0)
      return { value: value(other) - value(own), best: null };
    let best = -Infinity,
      bestMove: Move | null = null;
    for (const move of select(moves ?? search(board, own, deadline))) {
      const score = move?.score ?? 0;
      const result =
        move && !move.leave
          ? score + 2 * value(other)
          : score -
            turn(
              move ? prepare.place(board, move) : board,
              other,
              move?.leave ?? own,
              nextEndgameStreak(rule!, streak, move),
              depth - 1,
              score - beta,
              score - alpha,
              deadline,
            ).value;
      if (result > best) {
        best = result;
        bestMove = move;
      }
      if (best >= beta) break;
      alpha = Math.max(alpha, best);
    }
    return { value: best, best: bestMove };
  }
  const opponentPoints = value(opponent);
  return (candidate: Move, deadline: number): EndgameEstimate => {
    if (!rule) {
      const replies = opponentHasFinalTurn
        ? search(prepare.place(board, candidate), opponent, deadline)
        : undefined;
      const result = crossplayFinalRound(candidate, replies);
      return {
        spread: result.spread,
        exact: true,
        reply: result.line[1]
          ? {
              word: result.line[1].word,
              score: result.line[1].score,
              goesOut: false,
            }
          : undefined,
      };
    }
    if (!candidate.leave)
      return { spread: candidate.score + 2 * opponentPoints, exact: true };
    const afterPlay = nextEndgameStreak(rule, scorelessTurns, candidate);
    if (afterPlay >= rule.limit)
      return {
        spread: candidate.score + opponentPoints - value(candidate.leave),
        exact: true,
      };
    const after = prepare.place(board, candidate);
    const replies = search(after, opponent, deadline);
    // When every immediate reply (including pass) ends the game, evaluate all
    // of them directly. These trivial results can still be certified exact.
    if (
      afterPlay + 1 >= rule.limit &&
      replies.every(
        (move) =>
          !move.leave || nextEndgameStreak(rule, afterPlay, move) >= rule.limit,
      )
    ) {
      let best = value(candidate.leave) - opponentPoints;
      let reply: Move | null = null;
      for (const move of replies) {
        const score =
          move.score +
          (move.leave
            ? value(candidate.leave) - value(move.leave)
            : 2 * value(candidate.leave));
        if (score > best) {
          best = score;
          reply = move;
        }
      }
      return {
        spread: candidate.score - best,
        exact: true,
        reply: describe(reply),
      };
    }
    const result = turn(
      after,
      opponent,
      candidate.leave,
      afterPlay,
      PLIES - 1,
      -Infinity,
      Infinity,
      deadline,
      replies,
    );
    return {
      spread: candidate.score - result.value,
      exact: false,
      reply: describe(result.best),
    };
  };
}

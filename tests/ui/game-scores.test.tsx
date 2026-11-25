import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { gameReplayTimeline } from "../../shared/game-replay";
import { emptyScoring, summarizeGameScore } from "../../shared/game-scoring";
import { emptyBoard, type Game } from "../../shared/model";
import { PRESETS } from "../../shared/presets";
import { ReplayScores } from "../../src/components/GameReplay";
import GameScores from "../../src/components/GameScores";
import { MoveDefinitions } from "../../src/components/MoveDefinitions";
import ScoreChart from "../../src/components/ScoreChart";

function gameWithScores(you: number, opponent: number): Game {
  const scoring = emptyScoring();
  scoring.you.points = you;
  scoring.opponent.points = opponent;
  return {
    id: "score-ui", name: "Score UI", profileId: "p", dictionaryId: "test",
    board: emptyBoard(15), rack: "", template: PRESETS[0],
    past: [], future: [], revision: 0, updatedAt: "", archived: false,
    trackScores: true, scoring,
  };
}

function show(game: Game) {
  return render(<GameScores game={game} onToggle={vi.fn()} onRecord={vi.fn()}
    onCorrection={vi.fn()} onChange={vi.fn()} />);
}

test.each([
  [340, 346, "−6 pts", "value-bad"],
  [346, 340, "+6 pts", "value-good"],
  [340, 340, "0 pts", undefined],
] as const)("Game scores shows the signed score difference for %s–%s", (you, opponent, text, tone) => {
  const { container } = show(gameWithScores(you, opponent));
  const margin = screen.getByText(text);
  expect(margin.classList.contains("score-margin")).toBe(true);
  if (tone) expect(margin.classList.contains(tone)).toBe(true);
  else expect(margin.className).not.toMatch(/value-good|value-bad/);
  expect([...container.querySelectorAll(".score-players dt")].map(el => el.textContent)).toEqual(["You", "Opponent"]);
  expect([...container.querySelectorAll(".score-total")].map(el => el.textContent)).toEqual([`${you} pts`, `${opponent} pts`]);
});

test("partial scores keep their explanation instead of claiming a complete score difference", () => {
  const game = gameWithScores(340, 346);
  game.scoring!.incomplete = true;
  const { container } = show(game);
  expect(screen.getByText(/Partial scores/)).toBeTruthy();
  expect(container.querySelector(".score-margin")).toBeNull();
});

test.each(["you", "opponent"] as const)("Game scores shows a single chevron for %s's turn", (turn) => {
  const game = gameWithScores(340, 346);
  game.scoring!.you.moves = 12;
  game.scoring!.opponent.moves = 12;
  game.trackedMoves = [{ player: turn === "you" ? "opponent" : "you", word: "CAT", score: 3, at: "2026-11-17" }];
  const { container } = show(game);
  const active = screen.getByRole("img", { name: turn === "you" ? "Your turn" : "Opponent’s turn" });
  expect(active.classList.contains("score-turn-chevron")).toBe(true);
  expect(active.getAttribute("data-status")).toBe("turn");
  expect(active.closest("[data-player]")?.getAttribute("data-player")).toBe(turn);
  expect(container.querySelectorAll(".score-player-marker")).toHaveLength(1);
  expect(container.querySelector(".score-winner")).toBeNull();
});

test.each(["new", "partial", "archived"])("%s scores do not guess a turn or winner", (state) => {
  const game = gameWithScores(340, 346);
  if (state !== "new") {
    game.scoring!.you.moves = 1;
    game.trackedMoves = [{ player: "you", word: "CAT", score: 3, at: "2026-11-17" }];
  }
  if (state === "partial") game.scoring!.incomplete = true;
  if (state === "archived") game.archived = true;
  const { container } = show(game);
  expect(container.querySelector(".score-player-marker")).toBeNull();
  expect(container.querySelector(".score-winner")).toBeNull();
});

test.each([
  [340, 346, 5, "you", "You won"],
  [340, 360, 5, "opponent", "Opponent won"],
  [340, 346, 3, undefined, undefined],
] as const)("finished score %s–%s uses adjusted totals to choose the trophy", (you, opponent, rackPoints, winner, name) => {
  const game = gameWithScores(you, opponent);
  game.scoring!.end = { out: "you", rackPoints };
  const { container } = show(game);
  expect(container.querySelector(".score-turn-chevron")).toBeNull();
  expect(container.querySelectorAll(".score-winner")).toHaveLength(winner ? 1 : 0);
  if (name) {
    const marker = screen.getByRole("img", { name });
    expect(marker.closest("[data-player]")?.getAttribute("data-player")).toBe(winner);
    expect(marker.querySelector(".bingo-badge .lucide-trophy")).toBeTruthy();
  }
});

test("archived score markers follow the saved final result while the board is being edited", () => {
  const game = gameWithScores(400, 100);
  const final = gameWithScores(340, 346);
  final.scoring!.end = { manual: true, scores: { you: 340, opponent: 346 }, outcome: "loss" };
  game.archived = true;
  game.archivedState = { ...final, scoring: final.scoring };
  show(game);
  expect(screen.getByRole("img", { name: "Opponent won" })).toBeTruthy();
  expect(screen.queryByRole("img", { name: "You won" })).toBeNull();
});

test("an archive's final stats use the saved finish and replay stats use recorded plays", () => {
  const game = gameWithScores(100, 85);
  const scoring = game.scoring!;
  scoring.you = { points: 100, moves: 2, best: 76, bingos: 1 };
  scoring.opponent = { points: 85, moves: 2, best: 70, bingos: 1 };
  scoring.end = { out: "you", rackPoints: 6 };
  game.archived = true;
  game.trackedMoves = [
    { player: "you", word: "AT", score: 24, at: "" },
    { player: "opponent", word: "ART", score: 15, at: "" },
  ];
  const timeline = gameReplayTimeline(game);
  const seek = vi.fn();
  const { rerender } = render(
    <ReplayScores {...timeline} index={3} finalScoring={scoring} finalOutcome={summarizeGameScore(game)?.outcome} seek={seek} />,
  );
  const panel = within(screen.getByRole("region", { name: "Game scores" }));
  expect(panel.getByText("106")).toBeTruthy();
  expect(panel.getByText("79")).toBeTruthy();
  expect(panel.getByText("2 moves · Avg 50.0")).toBeTruthy();
  expect(panel.getByText("Best 76 · 1 bingo")).toBeTruthy();
  expect(panel.getByText("Best 70 · 1 bingo")).toBeTruthy();
  expect(panel.getByRole("img", { name: "You won" })).toBeTruthy();

  rerender(<ReplayScores {...timeline} index={1} seek={seek} />);
  expect(panel.getByText("1 move · Avg 24.0")).toBeTruthy();
  expect(panel.getByText("Best 24 · 0 bingos")).toBeTruthy();
  expect(panel.getByText("0 moves · Avg —")).toBeTruthy();
  expect(panel.queryByRole("img", { name: "You won" })).toBeNull();
  expect(panel.getByRole("img", { name: "Your turn" })).toBeTruthy();
});

test("the score chart pairs adjacent plays and carries forward the score for a missing reply", () => {
  const game = gameWithScores(107, 67);
  game.scoring!.you.moves = 2;
  game.scoring!.opponent.moves = 1;
  game.trackedMoves = [
    { player: "opponent", word: "RATION", score: 67, at: "2026-11-17" },
    { player: "you", word: "PLANTED", score: 80, bingo: true, at: "2026-11-17" },
    { player: "you", word: "OX", score: 27, at: "2026-11-17" },
  ];
  show(game);
  const chart = screen.getByRole("figure", { name: "Score by move" });
  const graph = within(chart).getByRole("img", { name: /Running scores/ });
  fireEvent.pointerMove(graph);
  const hoverTooltip = chart.querySelector(".score-chart-tooltip")!;
  expect([...hoverTooltip.querySelectorAll("dt")].map((label) => label.textContent))
    .toEqual(["You", "Opp"]);
  fireEvent.pointerLeave(graph);

  const slider = within(chart).getByRole("slider");
  expect(slider).toHaveProperty("max", "2");
  fireEvent.focus(slider);
  expect(slider.getAttribute("aria-valuetext")).toBe(
    "Move 3. You 107 points, OX for 27 points. Opponent 67 points",
  );

  const tooltip = chart.querySelector(".score-chart-tooltip")!;
  const plays = () => [...tooltip.querySelectorAll(".score-chart-play")]
    .map((play) => play.textContent);
  expect(plays()).toEqual(["OX+27 pts"]);
  const line = (player: string) =>
    chart.querySelector(`.score-chart-line.score-chart-${player}`)
      ?.getAttribute("points")
      ?.split(" ")
      .map((point) => point.split(","));
  const you = line("you")!;
  const opponent = line("opponent")!;
  expect(you.map(([x]) => x)).toEqual(opponent.map(([x]) => x));
  expect(opponent[2][1]).toBe(opponent[1][1]);

  fireEvent.change(slider, { target: { value: "1" } });
  expect(slider.getAttribute("aria-valuetext")).toBe(
    "Moves 1–2. You 80 points, PLANTED for 80 points, bingo. Opponent 67 points, RATION for 67 points",
  );
  expect(plays()).toEqual(["PLANTED+80 pts", "RATION+67 pts"]);
  expect(tooltip.querySelectorAll('.score-chart-play [aria-label="Bingo"]')).toHaveLength(1);
});

test("seeking on the replay chart keeps it in view when the layout above it changes", () => {
  const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  let graphTop = 280;
  function ReplayChart() {
    const [index, setIndex] = useState(2);
    return <ScoreChart
      moves={[
        { player: "you", word: "CAT", score: 10, number: 1 },
        { player: "opponent", word: "DOG", score: 12, number: 2 },
      ]}
      replay={{
        index,
        scores: index ? { you: 10, opponent: 12 } : { you: 0, opponent: 0 },
        seek(next) {
          if (next === 0) graphTop -= 110;
          setIndex(next);
        },
      }}
    />;
  }

  try {
    render(<ReplayChart />);
    const graph = screen.getByRole("img", { name: /Running scores/ });
    vi.spyOn(graph, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, graphTop, 500, 206));
    const slider = screen.getByRole("slider", { name: "Replay from move pair" });
    fireEvent.click(graph, { clientX: 31 });
    expect(slider).toHaveProperty("value", "0");
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -110, behavior: "instant" });

    fireEvent.change(slider, { target: { value: "1" } });
    expect(slider).toHaveProperty("value", "1");
    expect(scrollBy).toHaveBeenCalledTimes(1);
  } finally {
    scrollBy.mockRestore();
  }
});

test.each(["live", "replay"] as const)("the %s score tooltip defines its words on hover", async (view) => {
  const seek = vi.fn();
  const lookup = vi.fn(async () => new Response(JSON.stringify({
    available: true,
    entries: [[{ spelling: "cat", glosses: ["A small domesticated feline."] }]],
  })));
  vi.stubGlobal("fetch", lookup);
  vi.useFakeTimers();
  try {
    const { container } = render(
      <MoveDefinitions rules={PRESETS[0].rules} position="score chart" phoneLayout={false}>
        <ScoreChart
          moves={[
            { player: "you", word: "CAT", score: 10, number: 1 },
            { player: "opponent", word: "DOG", score: 12, number: 2 },
          ]}
          replay={view === "replay" ? { index: 2, scores: { you: 10, opponent: 12 }, seek } : undefined}
        />
      </MoveDefinitions>,
    );
    const graph = screen.getByRole("img", { name: /Running scores/ });
    if (view === "live") fireEvent.pointerMove(graph);
    const word = screen.getByText("CAT");
    expect(word.closest("button")).toBeNull();
    fireEvent.click(word);
    expect(seek).not.toHaveBeenCalled();
    const moveToWord = new Event("pointerout", { bubbles: true });
    Object.assign(moveToWord, { pointerType: "mouse", buttons: 0, relatedTarget: word });
    fireEvent(graph, moveToWord);
    await act(() => vi.advanceTimersByTimeAsync(500));
    const definition = screen.getByRole("tooltip");
    expect(within(definition).getByText("A small domesticated feline.")).toBeTruthy();
    expect(word.getAttribute("aria-describedby")).toBe(definition.id);
    expect(lookup).toHaveBeenCalledWith(
      "/api/definitions?language=en&word=CAT",
      expect.objectContaining({ method: "GET" }),
    );
    fireEvent.pointerOut(word, { relatedTarget: definition });
    expect(container.querySelector(".score-chart-tooltip")?.contains(word)).toBe(true);
    expect(screen.queryByRole("button", { name: /Jump to move/ })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("consecutive plays by one player stay distinct in an older archived history", () => {
  const game = gameWithScores(54, 32);
  game.scoring!.you.moves = 1;
  game.scoring!.opponent.moves = 2;
  game.archived = true;
  game.past = ([
    { player: "opponent", label: "RAT", score: 12 },
    { player: "opponent", label: "STAIN", score: 20 },
    { player: "you", label: "RAISED", score: 54 },
  ] as const).map((move) => ({
    ...move,
    at: "2026-11-17",
    board: game.board,
    rack: "",
  }));
  show(game);
  const chart = screen.getByRole("figure", { name: "Score by move" });
  const slider = within(chart).getByRole("slider");
  expect(slider.getAttribute("aria-valuetext")).toBe(
    "Moves 2–3. You 54 points, RAISED for 54 points. Opponent 32 points, STAIN for 20 points",
  );
  fireEvent.change(slider, { target: { value: "1" } });
  expect(slider.getAttribute("aria-valuetext")).toBe(
    "Move 1. You 0 points. Opponent 12 points, RAT for 12 points",
  );
});

test.each(["you", "opponent"] as const)(
  "replay carries the other score forward when %s has back-to-back recorded plays",
  (player) => {
    const other = player === "you" ? "opponent" : "you";
    const moves = [
      { player, word: "CAT", score: 10, number: 1 },
      { player, word: "DOG", score: 12, number: 2 },
      { player: other, word: "OX", score: 20, number: 3 },
    ] as const;
    const seek = vi.fn();
    const showChart = (index: number, scored: number, otherScore: number) =>
      <ScoreChart moves={moves} replay={{
        index,
        scores: player === "you"
          ? { you: scored, opponent: otherScore }
          : { you: otherScore, opponent: scored },
        seek,
      }} />;
    const { container, rerender } = render(showChart(1, 10, 0));
    const cursor = () => container.querySelector(".score-chart-cursor")!.getAttribute("x1");
    const first = cursor();
    expect(screen.getByText("No recorded play").closest("[data-unplayed]")?.querySelector(".score-chart-total")?.textContent).toBe("0");
    expect(screen.getByText("CAT")).toBeTruthy();
    expect(screen.queryByText("OX")).toBeNull();
    rerender(showChart(2, 22, 0));
    const pair = cursor();
    expect(pair).not.toBe(first);
    expect(screen.getByText("Moves 2–3")).toBeTruthy();
    expect(screen.getByText("Yet to play")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Jump to move/ })).toBeNull();
    rerender(showChart(3, 22, 20));
    expect(cursor()).toBe(pair);
    expect(screen.queryByText("Yet to play")).toBeNull();
    expect(screen.getByText("OX")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(seek).toHaveBeenCalledWith(1);
  },
);


test("the score chart starts over after a scoring reset and keeps the saved move log", async () => {
  const game = gameWithScores(0, 70);
  game.scoring!.historyStart = 1;
  game.scoring!.opponent.moves = 1;
  game.trackedMoves = [
    { player: "opponent", word: "OLD", score: 30, at: "2026-11-17" },
    { player: "opponent", word: "STEALER", score: 70, bingo: true, at: "2026-11-18" },
  ];
  const { rerender } = show(game);
  expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe(
    "Move 2. You 0 points. Opponent 70 points, STEALER for 70 points, bingo",
  );
  expect(screen.getByText("Tracked move history").parentElement?.textContent).toContain("(2)");
  const scoring = { ...emptyScoring(), historyStart: 2 };
  rerender(<GameScores game={{ ...game, scoring }} onToggle={vi.fn()} onRecord={vi.fn()}
    onCorrection={vi.fn()} onChange={vi.fn()} />);
  expect(screen.queryByRole("figure", { name: "Score by move" })).toBeNull();

  rerender(<ReplayScores {...gameReplayTimeline(game)} index={2} seek={vi.fn()} />);
  const details = screen.getByText("Tracked move history").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const table = within(await screen.findByRole("table", { name: "Tracked moves" }));
  const bingo = table.getByRole("button", { name: "Replay move 2: STEALER" });
  const row = within(bingo.closest("tr")!);
  expect(row.getByText("(100)")).toBeTruthy();
  expect(row.getByLabelText("Bingo")).toBeTruthy();
  expect(table.getByRole("button", { name: "Replay move 1: OLD" })).toBeTruthy();
});

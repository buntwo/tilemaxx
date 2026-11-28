import { SIMULATED_STYLE_LABELS, isSimulatedStyle } from "../../shared/simulated-styles";
import { ORDINARY_FOLLOW_UP_WEIGHT } from "../../shared/bingo-hunter";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { scorePlacement } from "../../shared/game-scoring";
import type { Game, Move } from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import { ScoreBreakdownContent } from "./ScoreBreakdown";
import { scoreTone } from "../score-tone";

import type { MoveStyle, MoveUtility } from "../../shared/move-results";
import {
  PLAYER_PROFILE_LABELS,
} from "../../shared/player-profiles";

const utilityNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const weightNumber = new Intl.NumberFormat("en", { maximumSignificantDigits: 3 });

export function formatUtility(value: number) {
  return utilityNumber.format(value);
}

export function formatStyleWeight(value: number) {
  return weightNumber.format(value);
}

type UtilityDetails = {
  profile: MoveStyle;
  utility: MoveUtility;
  checksDefense: boolean;
};

function UtilityBreakdown({ profile, utility, checksDefense }: UtilityDetails) {
  if ("kind" in utility && utility.kind !== "master") {
    const bingo = utility.kind !== "solo-points";
    return (
      <div className="score-breakdown-content">
        <div>{isSimulatedStyle(profile) && SIMULATED_STYLE_LABELS[profile]} · Rank {utility.rank}</div>
        <ul>
          <li className="score-breakdown-line">
            <span>Play points now</span><span>{utility.score}</span>
          </li>
          {bingo ? (
            <>
              <li className="score-breakdown-line">
                <span>Bingo now</span><span>{utility.bingoNow ? "Yes" : "No"}</span>
              </li>
              <li className="score-breakdown-line">
                <span>Next-turn bingo chance</span>
                <span>
                  {formatUtility(utility.bingoChance * 100)}%
                  {utility.kind === "solo-triple-threat" && ` · ${formatUtility(utility.bingoPoints)} pts`}
                </span>
              </li>
              {utility.kind === "solo-triple-threat" && (
                <li className="score-breakdown-line">
                  <span>Triple-word lane adjustment</span>
                  <span className={scoreTone(utility.lanePoints)}>{formatUtility(utility.lanePoints)}</span>
                </li>
              )}
            </>
          ) : (
            <>
              <li className="score-breakdown-line">
                <span>Expected points next turn</span><span>{formatUtility(utility.nextPoints)}</span>
              </li>
              <li className="score-breakdown-line">
                <span>Expected points two turns ahead</span><span>{formatUtility(utility.followUpPoints)}</span>
              </li>
            </>
          )}
        </ul>
        {utility.kind !== "solo-bingo" && (
          <div className="score-breakdown-line score-breakdown-total">
            <strong>{utility.kind === "solo-points" ? "Expected points across three plays" : "Utility"}</strong>
            <strong>{formatUtility(utility.total)}</strong>
          </div>
        )}
        <div className="move-score-adjustment">
          {utility.exact ? "All possible draws" : `${utility.samples} sampled draws`}
        </div>
      </div>
    );
  }
  if ("kind" in utility) {
    const factors = utility.endgame !== undefined
      ? [{ label: "Exact endgame continuation", value: utility.endgame - utility.score }]
      : [
        { label: "Expected opponent reply", value: utility.reply },
        { label: "Expected follow-up", value: utility.followUp },
        { label: "Rack leave difference", value: utility.leave },
        { label: "Final rack adjustments", value: utility.rackAdjustment },
      ];
    return (
      <div className="score-breakdown-content">
        <div>Master · Rank {utility.rank}</div>
        <ul>
          <li className="score-breakdown-line"><span>Play points now</span><span>{utility.score}</span></li>
          {factors.map(({ label, value }) => (
            <li className="score-breakdown-line" key={label}>
              <span>{label}</span><span className={scoreTone(value)}>{formatUtility(value)}</span>
            </li>
          ))}
        </ul>
        <div className="score-breakdown-line score-breakdown-total">
          <strong>{utility.endgame !== undefined ? "Endgame swing" : "Utility"}</strong>
          <strong>{formatUtility(utility.total)}</strong>
        </div>
        {utility.endgame === undefined && (
          <div className="move-score-adjustment">
            {utility.exactDeals ? "All possible tile deals" : `${utility.samples} shared tile deals`}
            {utility.bingoChance > 0 && ` · ${formatUtility(utility.bingoChance * 100)}% bingo next turn`}
          </div>
        )}
      </div>
    );
  }
  if ("playPoints" in utility) {
    return (
      <div className="score-breakdown-content">
        <div>{isSimulatedStyle(profile) && SIMULATED_STYLE_LABELS[profile]} · Rank {utility.rank}</div>
        <ul>
          <li className="score-breakdown-line">
            <span>Play points now</span>
            <span>{utility.playWeight === 1
              ? utility.playPoints
              : `${utility.playPoints} × ${utility.playWeight} = ${formatUtility(utility.weightedPlayPoints)}`}</span>
          </li>
          <li className="score-breakdown-line">
            <span>Expected bingo points next turn</span><span>{formatUtility(utility.nextBingoPoints)}</span>
          </li>
          {utility.tactics && (
            <>
              <li className="score-breakdown-line">
                <span>Expected opponent reply</span><span className={scoreTone(-utility.tactics.replyPoints)}>{formatUtility(-utility.tactics.replyPoints)}</span>
              </li>
              {utility.tactics.ordinaryPoints !== undefined && (
                <li className="score-breakdown-line">
                  <span>Ordinary follow-up when no bingo</span>
                  <span>{formatUtility(utility.tactics.ordinaryPoints)} × {ORDINARY_FOLLOW_UP_WEIGHT} = {formatUtility(utility.tactics.ordinaryPoints * ORDINARY_FOLLOW_UP_WEIGHT)}</span>
                </li>
              )}
              {utility.tactics.laneBonus !== undefined && (
                <li className="score-breakdown-line">
                  <span>Bingo lanes after reply</span><span className={scoreTone(utility.tactics.laneBonus)}>{formatUtility(utility.tactics.laneBonus)}</span>
                </li>
              )}
            </>
          )}
          <li className="score-breakdown-line">
            <span>Bingo chance after reply</span><span>{formatUtility(utility.bingoChance * 100)}%</span>
          </li>
          {utility.bingoChance > 0 && (
            <li className="score-breakdown-line">
              <span>Average best bingo when available</span><span>{formatUtility(utility.meanBingoScore)}</span>
            </li>
          )}
          {utility.highestBingo > 0 && (
            <li className="score-breakdown-line">
              <span>Highest bingo found</span><span>{utility.highestBingo}</span>
            </li>
          )}
        </ul>
        <div className="score-breakdown-line score-breakdown-total">
          <strong>Utility</strong><strong>{formatUtility(utility.total)}</strong>
        </div>
        <div className="move-score-adjustment">
          {utility.exact ? "Exact over tile deals" : `${utility.samples} sampled deals`} · Replies favor points and rack leave.
          {utility.tactics && utility.tactics.ordinaryPoints === undefined && " Follow-ups have yet to be checked."}
          {utility.close && " Too close to call among the top moves."}
        </div>
      </div>
    );
  }
  const factors = [
    { label: "Weighted points", value: utility.points, show: true },
    { label: "Premium squares", value: utility.premium },
    { label: "Rack leave", value: utility.leave },
    { label: "Lookahead adjustment", value: utility.lookahead, show: utility.lookahead !== undefined, tone: scoreTone(utility.lookahead) },
    { label: "Endgame lookahead", value: utility.endgame, show: utility.endgame !== undefined },
    { label: "Going out", value: utility.goingOut },
    {
      label: "Premium lane risk",
      value: utility.premiumLane,
      tone: scoreTone(utility.premiumLane),
    },
    {
      label: "Defense",
      value: utility.defense,
      show: utility.defense !== undefined,
    },
  ];
  return (
    <div className="score-breakdown-content">
      <div>
        {!isSimulatedStyle(profile) && PLAYER_PROFILE_LABELS[profile]} · Rank {utility.rank}
      </div>
      <ul>
        {factors.map(
          ({ label, value, show, tone }) =>
            (value || show) && (
              <li className="score-breakdown-line" key={label}>
                <span>{label}</span>
                <span className={tone ?? scoreTone(value)}>{formatUtility(value || 0)}</span>
              </li>
            ),
        )}
      </ul>
      <div className="score-breakdown-line score-breakdown-total">
        <strong>Appeal points</strong>
        <strong>{formatUtility(utility.total)}</strong>
      </div>
      <div className="score-breakdown-line">
        <span>Visibility weight</span>
        <span>{weightNumber.format(utility.visibility)}</span>
      </div>
      <div className="score-breakdown-line">
        <span>Appeal multiplier</span>
        <span>×{weightNumber.format(utility.appeal)}</span>
      </div>
      {(checksDefense || utility.endgame !== undefined || utility.lookahead !== undefined) && (
        <div className="move-score-adjustment">
          {utility.endgame !== undefined
            ? "Leading candidates were compared using the known endgame racks."
            : utility.lookahead !== undefined
              ? utility.followUpDeals === undefined
                ? `${utility.lookaheadDeals ?? 8} shared tile deals compare your play, the reply, and your next turn.`
                : `${utility.lookaheadDeals} sampled replies${utility.followUpDeals ? ` · ${utility.followUpDeals} follow-up draws` : ""}`
              : "Leading candidates are checked for premium threats before sampling."}
        </div>
      )}
    </div>
  );
}

export function useMoveScoreTooltip(
  game?: Game,
  describeAdjustment?: (move: Move) => string | undefined,
  describeUtility?: (move: Move) => UtilityDetails | undefined,
) {
  const id = useId();
  const [active, setActive] = useState<{
    move: Move;
    anchor: HTMLButtonElement;
    pinned: boolean;
  }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  const touchStart = useRef<{ x: number; y: number }>(undefined);
  const tip = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  function cancelTimer() {
    clearTimeout(timer.current);
  }
  function close() {
    cancelTimer();
    setActive(undefined);
  }
  function show(move: Move, anchor: HTMLButtonElement, pinned = false) {
    cancelTimer();
    setActive((current) =>
      current?.anchor === anchor && current.pinned && !pinned
        ? current
        : { move, anchor, pinned },
    );
  }
  function leave() {
    cancelTimer();
    timer.current = setTimeout(() => {
      setActive((current) => (current?.pinned ? current : undefined));
    }, 150);
  }
  useEffect(() => cancelTimer, []);
  useEffect(() => {
    if (!active) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".definition-tooltip, .definition-sheet")) return;
      if (
        event.target instanceof Node &&
        !active?.anchor.contains(event.target) &&
        !tip.current?.contains(event.target)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    function scroll(event: Event) {
      if (event.target !== tip.current) close();
    }
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [active]);
  useLayoutEffect(() => {
    if (!active || !tip.current) return;
    const anchor = active.anchor.getBoundingClientRect();
    const { width, height } = tip.current.getBoundingClientRect();
    const below = anchor.bottom + 4;
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
      top: Math.max(
        8,
        below + height <= window.innerHeight - 8
          ? below
          : anchor.top - height - 4,
      ),
    });
  }, [active]);

  const utility = active && describeUtility?.(active.move);
  const breakdown =
    !utility &&
    game &&
    active &&
    scorePlacement(
      game.board,
      placeTiles(game.board, active.move),
      game.template,
      active.move.direction,
    );
  const adjustment = !utility && active && describeAdjustment?.(active.move);
  return {
    close,
    trigger(move: Move, label: string) {
      return (
        <button
          type="button"
          className="result-score-trigger"
          aria-label={label}
          aria-describedby={active?.move.id === move.id ? id : undefined}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible"))
              show(move, event.currentTarget);
          }}
          onBlur={leave}
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") return;
            cancelTimer();
            const anchor = event.currentTarget;
            timer.current = setTimeout(() => show(move, anchor), 250);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") leave();
          }}
          onPointerDown={(event) => {
            if (event.isPrimary === false) return;
            held.current = false;
            if (event.pointerType !== "touch") return;
            cancelTimer();
            touchStart.current = { x: event.clientX, y: event.clientY };
            const anchor = event.currentTarget;
            timer.current = setTimeout(() => {
              held.current = true;
              show(move, anchor, true);
            }, 450);
          }}
          onPointerMove={(event) => {
            if (
              event.pointerType === "touch" &&
              touchStart.current &&
              Math.hypot(
                event.clientX - touchStart.current.x,
                event.clientY - touchStart.current.y,
              ) > 10
            )
              cancelTimer();
          }}
          onPointerUp={cancelTimer}
          onPointerCancel={cancelTimer}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            if (held.current) {
              held.current = false;
              return;
            }
            if (active?.anchor === event.currentTarget && active.pinned)
              close();
            else show(move, event.currentTarget, true);
          }}
        />
      );
    },
    popup:
      (utility || breakdown) &&
      createPortal(
        <div
          id={id}
          ref={tip}
          className="move-score-tooltip"
          role="tooltip"
          style={position}
          onPointerEnter={cancelTimer}
          onPointerLeave={leave}
        >
          {utility ? (
            <>
              <strong>{"visibility" in utility.utility ? "Style breakdown" : "Utility breakdown"}</strong>
              <UtilityBreakdown {...utility} />
            </>
          ) : (
            breakdown && (
              <>
                <strong>Score breakdown</strong>
                <ScoreBreakdownContent breakdown={breakdown} />
                {adjustment && (
                  <div className="move-score-adjustment">{adjustment}</div>
                )}
              </>
            )
          )}
        </div>,
        document.body,
      ),
  };
}

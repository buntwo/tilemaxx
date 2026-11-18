import { Fragment } from "react";
import { coordinate } from "../../shared/model";

export type CoordinateSelection = {
  row: number | null;
  column: number | null;
};

export function parseBoardCoordinate(query: string, size: number) {
  const match = /^([A-Z])(\d{1,2})?$|^(\d{1,2})([A-Z])?$/.exec(query);
  if (!match) return null;
  const [, letterFirst, downRow, acrossRow, letterLast] = match;
  const letter = letterFirst ?? letterLast;
  const digits = downRow ?? acrossRow;
  const row = digits === undefined ? null : Number(digits) - 1;
  const column = letter === undefined ? null : letter.charCodeAt(0) - 65;
  if (
    (row !== null && (row < 0 || row >= size)) ||
    (column !== null && column >= size)
  )
    return null;
  return {
    row,
    column,
    direction: letterFirst ? ("down" as const) : ("across" as const),
    // On larger boards, a leading 1 or 2 can be a complete row or a prefix.
    ambiguous: Boolean(
      letterFirst && digits?.length === 1 && Number(digits) * 10 <= size,
    ),
  };
}

export default function BoardCoordinates({
  size,
  selection,
}: {
  size: number;
  selection: CoordinateSelection;
}) {
  const { row, column } = selection;
  const axes = Array.from({ length: size }, (_, index) => index);
  return (
    <div className="board-grid board-coordinate-grid" aria-hidden="true">
      <span className="axis corner" />
      {axes.map((c) => (
        <span className="axis" key={c} data-match={c === column || undefined}>
          {String.fromCharCode(65 + c)}
        </span>
      ))}
      {axes.map((r) => (
        <Fragment key={r}>
          <span className="axis" data-match={r === row || undefined}>
            {r + 1}
          </span>
          {axes.map((c) => (
            <span
              className="board-coordinate-label"
              key={c}
              data-match={r === row || c === column || undefined}
              data-target={(r === row && c === column) || undefined}
            >
              {coordinate(r * size + c, size)}
            </span>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

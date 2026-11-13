import type { Placement, Position } from "./model";

// A dot is an empty rack slot; ? is an unassigned blank tile.
// Keep internal gaps in persisted positions, trimming only unused trailing slots.
export const rackLetters = (rack: string) => rack.replaceAll(".", "");
export const trimRack = (rack: string) => rack.replace(/\.+$/, "");

export function splitRack({
  rack,
  excludedRackSlots = [],
}: Pick<Position, "rack" | "excludedRackSlots">) {
  let available = "",
    held = "";
  for (let i = 0; i < rack.length; i++) {
    if (rack[i] === ".") continue;
    if (excludedRackSlots.includes(i)) held += rack[i];
    else available += rack[i];
  }
  return { available, held };
}

export function sortRack({
  rack,
  excludedRackSlots = [],
}: Pick<Position, "rack" | "excludedRackSlots">) {
  const tiles = [...rack].flatMap((letter, slot) =>
    letter === "."
      ? []
      : [{ letter, excluded: excludedRackSlots.includes(slot) }],
  );
  tiles.sort((a, b) => a.letter.charCodeAt(0) - b.letter.charCodeAt(0));
  return {
    rack: tiles.map(({ letter }) => letter).join(""),
    excludedRackSlots: tiles.flatMap(({ excluded }, slot) =>
      excluded ? [slot] : [],
    ),
  };
}

export function rackAfterMove(
  position: Position,
  tiles: readonly Placement[],
  leave: string,
) {
  const { excludedRackSlots } = position;
  if (!excludedRackSlots?.length) return leave;
  const remaining = [...position.rack];
  for (const { letter } of tiles) {
    const symbol = letter === letter.toUpperCase() ? letter : "?";
    const slot = remaining.findIndex(
      (tile, index) => tile === symbol && !excludedRackSlots.includes(index),
    );
    if (slot < 0) throw new Error("The rack changed. Find moves again.");
    remaining[slot] = ".";
  }
  return trimRack(remaining.join(""));
}
export function enterRack(
  rack: string,
  cursor: number,
  text: string,
  capacity: number,
) {
  const letters = text
    .toUpperCase()
    .replaceAll(" ", "?")
    .replace(/[^A-Z?]/g, "");
  let next = rack;
  let position = Math.max(0, Math.min(cursor, capacity));
  for (const letter of letters) {
    if (position >= capacity) break;
    next = next.padEnd(position, ".");
    next = next.slice(0, position) + letter + next.slice(position + 1);
    position++;
  }
  return { rack: trimRack(next), cursor: position };
}

export function eraseRack(
  rack: string,
  cursor: number,
  mode: "selected" | "backward" = "selected",
) {
  if (mode === "backward" && cursor <= 0) return { rack, cursor: 0 };
  const index = Math.max(0, cursor - (mode === "backward" ? 1 : 0));
  if (index >= rack.length) return { rack, cursor: index };
  return {
    rack: trimRack(rack.slice(0, index) + "." + rack.slice(index + 1)),
    cursor: index,
  };
}

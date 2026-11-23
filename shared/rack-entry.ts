import type { Placement, Position } from "./model";

// A dot is an empty rack slot; ? is an unassigned blank tile.
// Keep internal gaps in persisted positions, trimming only unused trailing slots.
export const rackLetters = (rack: string) => rack.replaceAll(".", "");
export const rackComposition = (rack: string) =>
  [...rackLetters(rack)].sort().join("");
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

export function reorderRack({
  rack,
  excludedRackSlots = [],
  requiredRackSlots = [],
}: Pick<Position, "rack" | "excludedRackSlots" | "requiredRackSlots">, order: readonly number[]) {
  const remap = (slots: number[]) =>
    order.flatMap((slot, index) => slots.includes(slot) ? [index] : []);
  return {
    rack: trimRack(order.map((slot) => rack[slot] ?? ".").join("")),
    excludedRackSlots: remap(excludedRackSlots),
    requiredRackSlots: remap(requiredRackSlots),
  };
}

export function sortedRackSlots(rack: string) {
  const tiles = [...rack].flatMap((letter, slot) =>
    letter === "." ? [] : [{ letter, slot }],
  );
  tiles.sort((a, b) => a.letter.charCodeAt(0) - b.letter.charCodeAt(0));
  return tiles.map(({ slot }) => slot);
}

export function sortRack(position: Pick<Position, "rack" | "excludedRackSlots" | "requiredRackSlots">) {
  return reorderRack(position, sortedRackSlots(position.rack));
}

export function shuffledRackSlots(rack: string) {
  const order = Array.from({ length: rack.length }, (_, i) => i);
  const occupied = order.filter((i) => rack[i] !== ".");
  for (let i = occupied.length - 1; i > 0; i--) {
    const from = occupied[i];
    const to = occupied[Math.floor(Math.random() * (i + 1))];
    [order[from], order[to]] = [order[to], order[from]];
  }
  if (occupied.every((i) => rack[i] === rack[order[i]])) {
    // Give a visible shuffle even if the random permutation only swapped duplicates.
    const first = occupied[0];
    const other = occupied.find((i) => rack[i] !== rack[first]);
    if (other !== undefined)
      [order[first], order[other]] = [order[other], order[first]];
  }
  return order;
}

export function movedRackSlots(size: number, from: number, to: number) {
  const order = Array.from({ length: size }, (_, i) => i);
  order.splice(from, 1);
  order.splice(to, 0, from);
  return order;
}

export function rackAfterMove(
  position: Position,
  tiles: readonly Placement[],
  leave: string,
) {
  if (
    !position.excludedRackSlots?.length &&
    !position.requiredRackSlots?.length
  )
    return leave;
  const slots = rackSlotsForMove(position, tiles);
  if (!slots) throw new Error("The rack changed. Find moves again.");
  const remaining = [...position.rack];
  for (const slot of slots) remaining[slot] = ".";
  return rackLetters(remaining.join(""));
}

export function rackSlotsForMove(
  position: Position,
  tiles: readonly Placement[],
) {
  return rackSlotsForLetters(
    position,
    tiles.map(({ letter }) => letter === letter.toUpperCase() ? letter : "?"),
  );
}

export function rackSlotsForLetters(
  { rack, excludedRackSlots = [], requiredRackSlots = [] }: Pick<
    Position, "rack" | "excludedRackSlots" | "requiredRackSlots"
  >,
  symbols: Iterable<string>,
) {
  const used = new Set(excludedRackSlots);
  const slots: number[] = [];
  const letters = [...rack];
  for (const symbol of symbols) {
    const required = requiredRackSlots.find(
      (index) => letters[index] === symbol && !used.has(index),
    );
    const slot =
      required ??
      letters.findIndex((tile, index) => tile === symbol && !used.has(index));
    if (slot < 0) return null;
    used.add(slot);
    slots.push(slot);
  }
  return requiredRackSlots.every((index) => slots.includes(index))
    ? slots
    : null;
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

// A dot is an empty rack slot; ? is an unassigned blank tile.
// Keep internal gaps in persisted positions, trimming only unused trailing slots.
export const rackLetters = (rack: string) => rack.replaceAll(".", "");
export const trimRack = (rack: string) => rack.replace(/\.+$/, "");
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

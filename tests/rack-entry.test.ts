import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enterRack,
  eraseRack,
  rackAfterMove,
  rackSlotsForMove,
} from "../shared/rack-entry";

test("move tiles match distinct rack slots, including blanks and held duplicates", () => {
  const position = { board: [], rack: "A.A?TTA", excludedRackSlots: [0, 4] };
  const tiles = [
    { index: 112, letter: "A" },
    { index: 113, letter: "a" },
    { index: 114, letter: "T" },
    { index: 115, letter: "A" },
  ];
  assert.deepEqual(rackSlotsForMove(position, tiles), [2, 3, 5, 6]);
  assert.equal(rackAfterMove(position, tiles, ""), "A...T");
  assert.equal(
    rackSlotsForMove(position, [...tiles, { index: 116, letter: "A" }]),
    null,
  );
});

test("rack entry converts spaces to unassigned blanks and replaces slots without shifting", () => {
  assert.deepEqual(enterRack("", 0, "c a?t", 7), { rack: "C?A?T", cursor: 5 });
  assert.deepEqual(enterRack("CATS", 1, "ow", 7), { rack: "COWS", cursor: 3 });
  assert.deepEqual(enterRack("AT", 6, "E", 7), { rack: "AT....E", cursor: 7 });
});
test("rack limits apply to custom sizes, pasted text and repeated full-rack input", () => {
  assert.deepEqual(enterRack("", 0, "abcdefghijk", 10), {
    rack: "ABCDEFGHIJ",
    cursor: 10,
  });
  assert.deepEqual(enterRack("CAT", 3, "S? ", 3), { rack: "CAT", cursor: 3 });
  assert.deepEqual(enterRack("CAT", 2, "S?", 3), { rack: "CAS", cursor: 3 });
  assert.deepEqual(enterRack("", 0, "c!a1t\n", 7), { rack: "CAT", cursor: 3 });
});
test("rack deletion erases only the selected slot, including the first and an empty slot", () => {
  assert.deepEqual(eraseRack("CAT?", 2), { rack: "CA.?", cursor: 2 });
  assert.deepEqual(eraseRack("CAT?", 1), { rack: "C.T?", cursor: 1 });
  assert.deepEqual(eraseRack("CAT", 0), { rack: ".AT", cursor: 0 });
  assert.deepEqual(eraseRack("CAT", 3), { rack: "CAT", cursor: 3 });
  assert.deepEqual(eraseRack("", 6), { rack: "", cursor: 6 });
});

test("delete and retype correct a selected middle typo without moving any other tile", () => {
  const deleted = eraseRack("COT?ERS", 1);
  assert.deepEqual(deleted, { rack: "C.T?ERS", cursor: 1 });
  assert.deepEqual(enterRack(deleted.rack, deleted.cursor, "a", 7), {
    rack: "CAT?ERS",
    cursor: 2,
  });
  assert.deepEqual(eraseRack("CA.T", 2), { rack: "CA.T", cursor: 2 });
  assert.deepEqual(eraseRack("...T", 3), { rack: "", cursor: 3 });
});

test("backward deletion moves onto the erased slot without shifting or skipping gaps", () => {
  assert.deepEqual(eraseRack("COT", 2, "backward"), { rack: "C.T", cursor: 1 });
  assert.deepEqual(eraseRack("C.T", 2, "backward"), { rack: "C.T", cursor: 1 });
  assert.deepEqual(eraseRack("CAT?DOG", 7, "backward"), {
    rack: "CAT?DO",
    cursor: 6,
  });
  assert.deepEqual(eraseRack("CAT", 1, "backward"), { rack: ".AT", cursor: 0 });
  assert.deepEqual(eraseRack("CAT", 0, "backward"), { rack: "CAT", cursor: 0 });
  assert.deepEqual(eraseRack("", 0, "backward"), { rack: "", cursor: 0 });
  assert.deepEqual(eraseRack("A", 1, "backward"), { rack: "", cursor: 0 });
});

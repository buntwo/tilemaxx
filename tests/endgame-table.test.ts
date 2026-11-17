import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEndgamePositionKeys,
  type EndgamePositionKey,
} from "../shared/endgame-position";
import {
  createEndgameTable,
  type EndgameTableEntry,
} from "../shared/endgame-table";
import { emptyBoard, type Move } from "../shared/model";
import { placeTiles } from "../shared/move-analysis";

const move = (index: number, letter: string) =>
  ({ tiles: [{ index, letter }] }) as Move;
function key(delta = [65], streak = 0): EndgamePositionKey {
  return {
    lo: 1,
    hi: 2,
    own: 3,
    other: 4,
    streak,
    delta: Uint16Array.from(delta),
  };
}
const entry = (
  value: number,
  best: EndgameTableEntry["best"] = undefined,
): EndgameTableEntry => ({
  value,
  flag: "lower",
  proved: false,
  depth: 6,
  best,
});

test("incremental position keys agree across placement order and independently reconstructed boards", () => {
  const keys = createEndgamePositionKeys(25, placeTiles),
    root = emptyBoard(5);
  root[12] = "A";
  const original = structuredClone(root);
  const a = keys.place(root, move(7, "T")),
    b = keys.place(root, move(13, "i"));
  const ab = keys.place(a, move(13, "i")),
    ba = keys.place(b, move(7, "T"));
  const expected = keys.key(ab, "A?", "BC", 0);
  assert.deepEqual(keys.key(ba, "A?", "BC", 0), expected);
  assert.deepEqual(keys.key([...ab], "A?", "BC", 0), expected);
  const natural = keys.place(a, move(13, "I"));
  assert.notDeepEqual(keys.key(natural, "A?", "BC", 0).delta, expected.delta);
  assert.notDeepEqual(keys.key(ab, "BC", "A?", 0), expected);
  assert.notDeepEqual(keys.key(ab, "A?", "BC", 1), expected);
  assert.deepEqual(root, original);
  const changed = [...root];
  changed[12] = "Z";
  assert.throws(
    () => keys.key(changed, "A?", "BC", 0),
    /root position changed/,
  );
  assert.throws(
    () => keys.place(root, move(12, "T")),
    /Invalid endgame placement/,
  );
});

test("packed hits verify all state fields even when both fingerprints collide", () => {
  const table = createEndgameTable(4),
    k = key();
  const e = entry(-123.5, { id: "1:A" });
  table.set(k, e);
  assert.deepEqual(table.get({ ...k, delta: Uint16Array.from(k.delta) }), e);
  for (const other of [
    key([91]),
    key([65, 129]),
    key([66]),
    key([65], 1),
    { ...k, own: 4 },
    { ...k, other: 3 },
    { ...k, hi: 3 },
    { ...k, lo: 5 },
  ])
    assert.equal(table.get(other), undefined);
  table.set(key([91]), entry(42, null));
  assert.deepEqual(table.get(k), e);
  assert.deepEqual(table.get(key([91])), entry(42, null));
});

test("packed updates preserve proved results and round-trip pass, missing move and bound flags", () => {
  const table = createEndgameTable(4),
    k = key();
  const proved = { ...entry(20, null), flag: "upper" as const, proved: true };
  table.set(k, proved);
  table.set(k, entry(-4, { id: "1:A" }));
  assert.deepEqual(table.get(k), proved);
  const exact = { ...proved, flag: "exact" as const, best: { id: "2:b" } };
  table.set(k, exact);
  table.set(k, { ...proved, value: -8 });
  assert.deepEqual(table.get(k), exact);
  table.set(key([66]), entry(0));
  assert.deepEqual(table.get(key([66])), entry(0));
});

test("bucket replacement keeps proved and deeper entries before equally recent shallow bounds", () => {
  const table = createEndgameTable(4);
  table.set(key([65]), { ...entry(1), proved: true, flag: "exact" });
  table.set(key([66]), { ...entry(2), proved: true });
  table.set(key([67]), { ...entry(3), depth: 8 });
  table.set(key([68]), { ...entry(4), depth: 1 });
  table.set(key([69]), entry(5));
  assert.equal(table.evictions, 1);
  assert.equal(table.size, 4);
  assert.equal(table.get(key([68])), undefined);
  for (const i of [65, 66, 67, 69]) assert.ok(table.get(key([i])));
  const aged = createEndgameTable(4);
  for (let i = 65; i < 70; i++) aged.set(key([i]), entry(i));
  assert.equal(aged.get(key([65])), undefined);
});

test("move ID storage and partial buckets stay bounded through repeated replacements", () => {
  for (const capacity of [1, 2, 3, 5]) {
    const table = createEndgameTable(capacity);
    for (let i = 0; i < 1000; i++) {
      const k = key([i + 1]);
      table.set(k, entry(i, { id: `${i}:A` }));
      assert.deepEqual(table.get(k), entry(i, { id: `${i}:A` }));
      assert.ok(table.size <= capacity);
      assert.ok(table.moveSlots <= capacity);
    }
    assert.ok(table.evictions > 0);
  }
  const shared = createEndgameTable(2);
  shared.set(key([1]), entry(1, { id: "1:A" }));
  shared.set(key([2]), entry(2, { id: "1:A" }));
  shared.set(key([1]), entry(3, null));
  assert.deepEqual(shared.get(key([2]))?.best, { id: "1:A" });
  shared.set(key([1]), entry(4, { id: "1:A" }));
  assert.deepEqual(shared.get(key([1]))?.best, { id: "1:A" });
});

test("packed storage rejects overflowing states instead of silently truncating them", () => {
  const table = createEndgameTable(4);
  assert.throws(() => createEndgameTable(0), /table size/);
  assert.throws(() => table.set(key(Array(21).fill(1)), entry(1)), /overflow/);
  assert.throws(
    () => table.set(key(), { ...entry(1), depth: 256 }),
    /overflow/,
  );
  assert.throws(() => table.set(key([1], 256), entry(1)), /overflow/);
  assert.ok(createEndgameTable(250000).storageBytes < 21_000_000);
});

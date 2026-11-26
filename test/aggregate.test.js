// Property-based tests for the fairness rules in kit/shared/aggregate.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createAggregator } from '../kit/shared/aggregate.js';

const unit = fc.double({ min: -1, max: 1, noNaN: true });
const playerIds = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 12 });

// A stream of tilt inputs: [playerIndex, x, y].
const stream = fc.array(fc.tuple(fc.nat(), unit, unit), { minLength: 1, maxLength: 80 });

function feed(agg, ids, events, now = 0) {
  const seqs = new Map();
  for (const [i, x, y] of events) {
    const id = ids[i % ids.length];
    const seq = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, seq);
    agg.accept(id, { kind: 'tilt', seq, x, y }, now);
  }
}

// Reference model: the mean of each player's last tilt.
function model(ids, events) {
  const last = new Map();
  for (const [i, x, y] of events) last.set(ids[i % ids.length], { x, y });
  const vals = [...last.values()];
  const n = vals.length;
  return {
    x: vals.reduce((s, v) => s + v.x, 0) / n,
    y: vals.reduce((s, v) => s + v.y, 0) / n,
    n,
  };
}

test('PBT: result equals the mean of each player\'s latest tilt', () => {
  fc.assert(
    fc.property(playerIds, stream, (ids, events) => {
      const agg = createAggregator();
      feed(agg, ids, events);
      const got = agg.tilt(0);
      const want = model(ids, events);
      assert.equal(got.n, want.n);
      assert.ok(Math.abs(got.x - want.x) < 1e-9);
      assert.ok(Math.abs(got.y - want.y) < 1e-9);
    }),
  );
});

test('PBT: output always stays within -1..1', () => {
  fc.assert(
    fc.property(playerIds, stream, (ids, events) => {
      const agg = createAggregator();
      feed(agg, ids, events);
      const { x, y } = agg.tilt(0);
      assert.ok(x >= -1 && x <= 1 && y >= -1 && y <= 1);
    }),
  );
});

test('PBT: result does not depend on the order players arrive in', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.tuple(fc.stringMatching(/^[a-z]{1,6}$/), unit, unit), { minLength: 1, maxLength: 20, selector: (t) => t[0] }),
      fc.infiniteStream(fc.nat()),
      (finalTilts, randoms) => {
        const a = createAggregator();
        const b = createAggregator();
        for (const [id, x, y] of finalTilts) a.accept(id, { kind: 'tilt', seq: 1, x, y }, 0);
        // Shuffle using the generated random stream.
        const shuffled = [...finalTilts];
        const it = randoms[Symbol.iterator]();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = it.next().value % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        for (const [id, x, y] of shuffled) b.accept(id, { kind: 'tilt', seq: 1, x, y }, 0);
        // Exactly equal, not just close: summation order is fixed.
        assert.deepEqual(a.tilt(0), b.tilt(0));
      },
    ),
  );
});

test('PBT: sending more messages gives no extra influence (one phone, one vote)', () => {
  fc.assert(
    fc.property(unit, unit, unit, unit, fc.integer({ min: 1, max: 200 }), (ax, ay, bx, by, spam) => {
      const agg = createAggregator();
      // Player "a" sends once; player "b" floods the room with the same value.
      agg.accept('a', { kind: 'tilt', seq: 1, x: ax, y: ay }, 0);
      for (let s = 1; s <= spam; s++) agg.accept('b', { kind: 'tilt', seq: s, x: bx, y: by }, 0);
      const r = agg.tilt(0);
      assert.equal(r.n, 2);
      assert.ok(Math.abs(r.x - (ax + bx) / 2) < 1e-9);
      assert.ok(Math.abs(r.y - (ay + by) / 2) < 1e-9);
    }),
  );
});

test('PBT: replayed or out-of-order inputs are ignored', () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.nat({ max: 50 }), unit, unit), { minLength: 1, maxLength: 60 }), (events) => {
      const agg = createAggregator();
      let maxSeq = -1;
      let expected = null;
      for (const [seq, x, y] of events) {
        const accepted = agg.accept('p', { kind: 'tilt', seq, x, y }, 0);
        assert.equal(accepted, seq > maxSeq);
        if (seq > maxSeq) {
          maxSeq = seq;
          expected = { x, y };
        }
      }
      const r = agg.tilt(0);
      assert.ok(Math.abs(r.x - expected.x) < 1e-12 && Math.abs(r.y - expected.y) < 1e-12);
    }),
  );
});

test('PBT: a player who left and rejoined still has exactly one vote', () => {
  fc.assert(
    fc.property(unit, unit, unit, unit, fc.integer({ min: 1, max: 10 }), (x1, y1, x2, y2, cycles) => {
      const agg = createAggregator();
      agg.accept('other', { kind: 'tilt', seq: 1, x: 0, y: 0 }, 0);
      let seq = 0;
      for (let c = 0; c < cycles; c++) {
        agg.accept('p', { kind: 'tilt', seq: ++seq, x: x1, y: y1 }, 0);
        agg.clearInputs('p'); // left
      }
      agg.accept('p', { kind: 'tilt', seq: ++seq, x: x2, y: y2 }, 0); // back again
      const r = agg.tilt(0);
      assert.equal(r.n, 2);
      assert.ok(Math.abs(r.x - x2 / 2) < 1e-9);
    }),
  );
});

test('stale inputs drop out after the window', () => {
  const agg = createAggregator({ staleMs: 1000 });
  agg.accept('a', { kind: 'tilt', seq: 1, x: 1, y: 0 }, 0);
  agg.accept('b', { kind: 'tilt', seq: 1, x: -1, y: 0 }, 900);
  assert.equal(agg.tilt(950).n, 2);
  const later = agg.tilt(1500);
  assert.equal(later.n, 1);
  assert.equal(later.x, -1);
  assert.deepEqual(agg.tilt(5000), { x: 0, y: 0, n: 0 });
});

test('a player who left stops counting at once', () => {
  const agg = createAggregator();
  agg.accept('a', { kind: 'tilt', seq: 1, x: 1, y: 1 }, 0);
  agg.clearInputs('a');
  assert.equal(agg.tilt(0).n, 0);
  // A replay of the old message still cannot count.
  assert.equal(agg.accept('a', { kind: 'tilt', seq: 1, x: 1, y: 1 }, 0), false);
});

test('PBT: influence shares sum to 1', () => {
  fc.assert(
    fc.property(playerIds, stream, (ids, events) => {
      const agg = createAggregator();
      feed(agg, ids, events);
      const total = agg.influence(0).reduce((s, p) => s + p.share, 0);
      assert.ok(Math.abs(total - 1) < 1e-9);
    }),
  );
});

test('taps count distinct players, shake is averaged', () => {
  const agg = createAggregator();
  agg.accept('a', { kind: 'tap', seq: 1 }, 0);
  agg.accept('a', { kind: 'tap', seq: 2 }, 10);
  agg.accept('b', { kind: 'tap', seq: 1 }, 20);
  assert.equal(agg.taps(30), 2);
  agg.accept('a', { kind: 'shake', seq: 3, v: 1 }, 0);
  agg.accept('b', { kind: 'shake', seq: 2, v: 0.5 }, 0);
  assert.deepEqual(agg.shake(0), { v: 0.75, n: 2 });
});

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

test('PBT: a newer connection always wins; replays inside a connection never count', () => {
  // Each event: [epoch, seq]. Acceptance must follow (epoch, seq) order.
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.nat(5), fc.nat(1_000_000)), { minLength: 1, maxLength: 60 }), (events) => {
      const agg = createAggregator();
      let last = [0, -1];
      for (const [e, seq] of events) {
        const accepted = agg.accept('p', { kind: 'tap', seq, e }, 0);
        const newer = e > last[0] || (e === last[0] && seq > last[1]);
        assert.equal(accepted, newer, `epoch ${e} seq ${seq} after ${last}`);
        if (newer) last = [e, seq];
      }
    }),
  );
});

test('a reconnection with lower sequence numbers still counts', () => {
  const agg = createAggregator();
  // Newer tab: high seq, epoch 1. Older tab reconnects: low seq, epoch 2.
  assert.equal(agg.accept('p', { kind: 'tilt', seq: 2_000_001, e: 1, x: 0.5, y: 0 }, 0), true);
  assert.equal(agg.accept('p', { kind: 'tilt', seq: 1_000_001, e: 2, x: -0.8, y: 0 }, 0), true);
  assert.equal(agg.tilt(0).x, -0.8);
  // A late message from the replaced connection is ignored.
  assert.equal(agg.accept('p', { kind: 'tilt', seq: 2_000_002, e: 1, x: 1, y: 0 }, 0), false);
});

// ---------- agreement (coherence) ----------

test('coherence: everyone the same way is 1, opposite pushes are 0, nobody is 0', () => {
  const agg = createAggregator();
  assert.equal(agg.coherence(0), 0);
  agg.accept('a', { kind: 'tilt', seq: 1, x: 0.5, y: 0 }, 0);
  agg.accept('b', { kind: 'tilt', seq: 1, x: 0.5, y: 0 }, 0);
  assert.equal(agg.coherence(0), 1);
  agg.accept('b', { kind: 'tilt', seq: 2, x: -0.5, y: 0 }, 0);
  assert.equal(agg.coherence(0), 0);
});

test('PBT: coherence is within 0..1, order-independent and unchanged by scaling', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.tuple(fc.stringMatching(/^[a-z]{1,5}$/), unit, unit), { minLength: 1, maxLength: 20, selector: (t) => t[0] }),
      fc.double({ min: 0.1, max: 1, noNaN: true }),
      (tilts, k) => {
        const a = createAggregator();
        const b = createAggregator();
        const c = createAggregator();
        for (const [id, x, y] of tilts) a.accept(id, { kind: 'tilt', seq: 1, x, y }, 0);
        for (const [id, x, y] of [...tilts].reverse()) b.accept(id, { kind: 'tilt', seq: 1, x, y }, 0);
        for (const [id, x, y] of tilts) c.accept(id, { kind: 'tilt', seq: 1, x: x * k, y: y * k }, 0);
        const h = a.coherence(0);
        assert.ok(h >= 0 && h <= 1);
        assert.equal(h, b.coherence(0));
        // Scaling every tilt by the same amount does not change agreement.
        // (Skip near-zero rooms, where rounding dominates.)
        const total = tilts.reduce((s, [, x, y]) => s + Math.hypot(x, y), 0);
        if (total > 1e-3) assert.ok(Math.abs(h - c.coherence(0)) < 1e-6);
      },
    ),
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
  assert.deepEqual(agg.shake(0), { v: 0.75, n: 2, peak: 1, energy: 0.75 });
  // With 6 phones in the room, two shakers only fill a quarter of the meter.
  assert.equal(agg.shake(0, 6).energy, 0.25);
});

// ---------- multiple choice ----------

const vote = fc.tuple(fc.nat(9), fc.nat(7), fc.nat(2)); // [player, option, round]

// Reference model: each player's last vote; count those in the round.
function tallyModel(votes, round, optionCount) {
  const last = new Map();
  for (const [p, o, r] of votes) last.set(p, { o, r });
  const counts = new Array(optionCount).fill(0);
  for (const { o, r } of last.values()) if (r === round && o < optionCount) counts[o]++;
  const best = Math.max(0, ...counts);
  const leaders = counts.flatMap((n, i) => (n === best && n > 0 ? [i] : []));
  return { counts, total: counts.reduce((a, b) => a + b, 0), leader: leaders.length === 1 ? leaders[0] : null };
}

test('PBT: tally matches the model (one vote per player, latest wins, round filter, ties)', () => {
  fc.assert(
    fc.property(fc.array(vote, { maxLength: 80 }), fc.nat(2), fc.integer({ min: 1, max: 8 }), (votes, round, optionCount) => {
      const agg = createAggregator();
      const seqs = new Map();
      for (const [p, o, r] of votes) {
        const seq = (seqs.get(p) ?? 0) + 1;
        seqs.set(p, seq);
        agg.accept(`p${p}`, { kind: 'choice', seq, o, r }, 0);
      }
      assert.deepEqual(agg.tally(round, optionCount), tallyModel(votes, round, optionCount));
    }),
  );
});

test('PBT: total votes never exceed the number of players', () => {
  fc.assert(
    fc.property(fc.array(vote, { maxLength: 80 }), (votes) => {
      const agg = createAggregator();
      let seq = 0;
      for (const [p, o, r] of votes) agg.accept(`p${p}`, { kind: 'choice', seq: ++seq, o, r }, 0);
      const players = new Set(votes.map(([p]) => p)).size;
      for (let r = 0; r < 3; r++) assert.ok(agg.tally(r, 8).total <= players);
    }),
  );
});

test('votes from an old round do not count in the new one, and leaving removes a vote', () => {
  const agg = createAggregator();
  agg.accept('a', { kind: 'choice', seq: 1, o: 2, r: 1 }, 0);
  agg.accept('b', { kind: 'choice', seq: 1, o: 2, r: 2 }, 0);
  assert.deepEqual(agg.tally(2, 4), { counts: [0, 0, 1, 0], total: 1, leader: 2 });
  agg.clearInputs('b');
  assert.deepEqual(agg.tally(2, 4), { counts: [0, 0, 0, 0], total: 0, leader: null });
});

test('PBT: shake energy is never more than the shakers\' mean, and peak bounds it', () => {
  fc.assert(
    fc.property(
      fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 30 }),
      fc.nat(40),
      (values, participants) => {
        const agg = createAggregator();
        values.forEach((v, i) => agg.accept(`p${i}`, { kind: 'shake', seq: 1, v }, 0));
        const s = agg.shake(0, participants);
        assert.equal(s.n, values.length);
        assert.ok(s.energy <= s.v + 1e-12);
        assert.ok(s.v <= s.peak + 1e-12);
        assert.ok(s.peak <= 1 && s.energy >= 0);
      },
    ),
  );
});
test('PBT: choice tally counts each player once and ignores arrival order', () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 3 })), { minLength: 1, maxLength: 40 }), (votes) => {
      const run = (list) => {
        const agg = createAggregator();
        list.forEach(([p, o], i) => agg.accept(`p${p}`, { kind: 'choice', seq: i, o, r: 1 }, 0));
        return agg.tally(1, 4);
      };
      const t = run(votes);
      assert.ok(t.total <= new Set(votes.map(([p]) => p)).size);
      assert.equal(t.counts.reduce((a, b) => a + b, 0), t.total);
      // Each player's last vote only, so a reversed stream with unique players matches.
      const firstPerPlayer = [...new Map(votes.map(([p, o]) => [p, [p, o]])).values()];
      assert.deepEqual(run(firstPerPlayer).counts, run([...firstPerPlayer].reverse()).counts);
    }),
  );
});
test('a replayed choice with a lower seq does not change the vote', () => {
  const agg = createAggregator();
  assert.equal(agg.accept('a', { kind: 'choice', seq: 5, o: 1, r: 1 }, 0), true);
  assert.equal(agg.accept('a', { kind: 'choice', seq: 4, o: 2, r: 1 }, 0), false);
  assert.deepEqual(agg.tally(1, 3).counts, [0, 1, 0]);
});

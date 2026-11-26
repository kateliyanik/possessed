import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { LIMITS, byteLength, isRoomCode, normalizeRoomCode, parseClientMessage } from '../kit/shared/protocol.js';

const enc = (o) => JSON.stringify(o);

test('valid phone hello is accepted and normalised', () => {
  const r = parseClientMessage(enc({ t: 'hello', role: 'phone', room: 'abcd', playerId: 'p_123', device: 'ios' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'hello', role: 'phone', room: 'ABCD', playerId: 'p_123', device: 'ios' });
});

test('unknown device becomes "other"', () => {
  const r = parseClientMessage(enc({ t: 'hello', role: 'phone', room: 'ABCD', playerId: 'x1', device: '<script>' }));
  assert.equal(r.msg.device, 'other');
});

test('room codes exclude I and O', () => {
  assert.equal(isRoomCode('ABCD'), true);
  assert.equal(isRoomCode('ABCI'), false);
  assert.equal(isRoomCode('ABCO'), false);
  assert.equal(normalizeRoomCode('  wxyz '), 'WXYZ');
});

test('screen hello ignores a partial reclaim', () => {
  const r = parseClientMessage(enc({ t: 'hello', role: 'screen', room: 'ABCD' }));
  assert.deepEqual(r.msg, { t: 'hello', role: 'screen' });
});

test('rejects bad envelopes', () => {
  for (const raw of ['', 'nope', '[]', 'null', '42', enc({ t: 'boom' }), enc({ t: 'input', kind: 'tilt', seq: -1, x: 0, y: 0 })]) {
    assert.equal(parseClientMessage(raw).ok, false, raw);
  }
  assert.equal(parseClientMessage(Buffer.from('{}')).ok, false);
});

test('choice inputs need a whole option index and round, never clamped', () => {
  const ok = parseClientMessage(enc({ t: 'input', kind: 'choice', seq: 1, o: 3, r: 7 }));
  assert.deepEqual(ok.msg, { t: 'input', kind: 'choice', seq: 1, o: 3, r: 7 });
  for (const bad of [{ o: 8, r: 0 }, { o: -1, r: 0 }, { o: 1.5, r: 0 }, { o: '1', r: 0 }, { o: 1, r: -1 }, { o: 1 }]) {
    assert.equal(parseClientMessage(enc({ t: 'input', kind: 'choice', seq: 1, ...bad })).ok, false, JSON.stringify(bad));
  }
});

test('PBT: any accepted choice is a valid option index', () => {
  fc.assert(
    fc.property(fc.anything(), fc.anything(), (o, r) => {
      const res = parseClientMessage(JSON.stringify({ t: 'input', kind: 'choice', seq: 1, o, r }) ?? '');
      if (res.ok) {
        assert.ok(Number.isInteger(res.msg.o) && res.msg.o >= 0 && res.msg.o < LIMITS.maxOptions);
        assert.ok(Number.isInteger(res.msg.r) && res.msg.r >= 0);
      }
    }),
  );
});

test('shake needs a number', () => {
  assert.equal(parseClientMessage(enc({ t: 'input', kind: 'shake', seq: 1 })).ok, false);
  assert.equal(parseClientMessage(enc({ t: 'input', kind: 'shake', seq: 1, v: 9 })).msg.v, 1);
});

test('rejects messages over the size limit', () => {
  const big = enc({ t: 'ping', c: 1, pad: 'x'.repeat(LIMITS.maxMessageBytes) });
  assert.equal(parseClientMessage(big).error, 'too_large');
});

test('byteLength matches UTF-8 encoding', () => {
  fc.assert(
    fc.property(fc.string({ unit: 'binary' }), (s) => {
      assert.equal(byteLength(s), Buffer.byteLength(s, 'utf8'));
    }),
  );
});

test('PBT: tilt values are always clamped to -1..1', () => {
  fc.assert(
    fc.property(fc.double(), fc.double(), fc.nat(), (x, y, seq) => {
      const r = parseClientMessage(enc({ t: 'input', kind: 'tilt', seq, x, y }));
      // JSON turns NaN and Infinity into null, which is not a number.
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        assert.equal(r.ok, false);
        return;
      }
      assert.equal(r.ok, true);
      assert.ok(r.msg.x >= -1 && r.msg.x <= 1);
      assert.ok(r.msg.y >= -1 && r.msg.y <= 1);
    }),
  );
});

test('PBT: the parser never throws on arbitrary input', () => {
  fc.assert(
    fc.property(fc.oneof(fc.string(), fc.json(), fc.anything().map((v) => JSON.stringify(v) ?? '')), (raw) => {
      const r = parseClientMessage(raw);
      assert.equal(typeof r.ok, 'boolean');
    }),
    { numRuns: 500 },
  );
});

test('PBT: accepted messages only contain known fields', () => {
  const allowed = new Set(['t', 'role', 'room', 'key', 'playerId', 'device', 'kind', 'seq', 'x', 'y', 'v', 'o', 'r', 'c', 'data', 'rtt', 'hz']);
  fc.assert(
    fc.property(
      fc.record({
        t: fc.constantFrom('hello', 'input', 'ping', 'stats'),
        role: fc.constantFrom('screen', 'phone'),
        room: fc.constantFrom('ABCD', 'zzzz'),
        playerId: fc.constantFrom('p1', 'bad id'),
        kind: fc.constantFrom('tilt', 'tap', 'shake', 'choice'),
        o: fc.integer({ min: -2, max: 10 }),
        r: fc.integer({ min: -2, max: 10 }),
        seq: fc.nat(),
        x: fc.double({ noNaN: true, noDefaultInfinity: true }),
        y: fc.double({ noNaN: true, noDefaultInfinity: true }),
        v: fc.double({ noNaN: true, noDefaultInfinity: true }),
        c: fc.integer(),
        rtt: fc.integer(),
        hz: fc.integer(),
        evil: fc.string(),
      }),
      (obj) => {
        const r = parseClientMessage(enc(obj));
        if (r.ok) for (const k of Object.keys(r.msg)) assert.ok(allowed.has(k), k);
      },
    ),
  );
});
test('choice input: valid option and round are accepted with only known fields', () => {
  const r = parseClientMessage(enc({ t: 'input', kind: 'choice', seq: 1, o: 2, r: 7, evil: 'x' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.msg, { t: 'input', kind: 'choice', seq: 1, o: 2, r: 7 });
});
test('PBT: choice is accepted only for an in-range integer option and round, and never altered', () => {
  fc.assert(
    fc.property(fc.anything(), fc.anything(), fc.nat(), (o, r, seq) => {
      const res = parseClientMessage(enc({ t: 'input', kind: 'choice', seq, o, r }));
      const valid =
        Number.isInteger(o) && o >= 0 && o < LIMITS.maxOptions && Number.isInteger(r) && r >= 0 && r <= LIMITS.maxRound;
      assert.equal(res.ok, valid);
      if (res.ok) {
        assert.equal(res.msg.o, o);
        assert.equal(res.msg.r, r);
      }
    }),
  );
});

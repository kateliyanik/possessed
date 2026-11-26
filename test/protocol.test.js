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
  const allowed = new Set(['t', 'role', 'room', 'key', 'playerId', 'device', 'kind', 'seq', 'x', 'y', 'v', 'c', 'data', 'rtt', 'hz']);
  fc.assert(
    fc.property(
      fc.record({
        t: fc.constantFrom('hello', 'input', 'ping', 'stats'),
        role: fc.constantFrom('screen', 'phone'),
        room: fc.constantFrom('ABCD', 'zzzz'),
        playerId: fc.constantFrom('p1', 'bad id'),
        kind: fc.constantFrom('tilt', 'tap', 'shake'),
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

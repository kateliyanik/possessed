import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { FULL_TILT_DEG, anglesToTilt, shakeEnergy } from '../kit/client/motion.js';

test('level phone gives zero tilt', () => {
  const r = anglesToTilt(0, 0);
  assert.equal(Math.abs(r.x), 0);
  assert.equal(Math.abs(r.y), 0);
});

test('tilting right and forward in portrait', () => {
  assert.deepEqual(anglesToTilt(0, FULL_TILT_DEG), { x: 1, y: 0 });
  assert.deepEqual(anglesToTilt(FULL_TILT_DEG / 2, 0), { x: 0, y: 0.5 });
});

test('calibration offsets the baseline', () => {
  assert.deepEqual(anglesToTilt(10, 5, 0, { beta: 10, gamma: 5 }), { x: 0, y: 0 });
});

test('PBT: output always within -1..1 for any angles and rotation', () => {
  fc.assert(
    fc.property(
      fc.double({ min: -180, max: 180, noNaN: true }),
      fc.double({ min: -90, max: 90, noNaN: true }),
      fc.constantFrom(0, 90, 180, 270, -90),
      (beta, gamma, angle) => {
        const { x, y } = anglesToTilt(beta, gamma, angle);
        assert.ok(x >= -1 && x <= 1 && y >= -1 && y <= 1);
      },
    ),
  );
});

test('shake energy: still is 0, a hard shake is 1', () => {
  assert.equal(shakeEnergy(0, 0, 0), 0);
  assert.equal(shakeEnergy(1, 1, 1), 0); // ordinary handling
  assert.equal(shakeEnergy(25, 0, 0), 1);
  assert.equal(shakeEnergy(null, undefined, 0), 0);
});

test('PBT: shake energy is within 0..1 and grows with acceleration', () => {
  const acc = fc.double({ min: -80, max: 80, noNaN: true });
  fc.assert(
    fc.property(acc, acc, acc, fc.double({ min: 1, max: 3, noNaN: true }), (x, y, z, k) => {
      const e = shakeEnergy(x, y, z);
      assert.ok(e >= 0 && e <= 1);
      assert.ok(shakeEnergy(x * k, y * k, z * k) >= e - 1e-12);
    }),
  );
});

test('PBT: rotating the screen 180° flips both axes', () => {
  fc.assert(
    fc.property(fc.double({ min: -20, max: 20, noNaN: true }), fc.double({ min: -20, max: 20, noNaN: true }), (b, g) => {
      const a = anglesToTilt(b, g, 0);
      const r = anglesToTilt(b, g, 180);
      assert.ok(Math.abs(a.x + r.x) < 1e-12 && Math.abs(a.y + r.y) < 1e-12);
    }),
  );
});

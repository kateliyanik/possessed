import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { FULL_TILT_DEG, anglesToTilt } from '../kit/client/motion.js';

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

test('PBT: rotating the screen 180° flips both axes', () => {
  fc.assert(
    fc.property(fc.double({ min: -20, max: 20, noNaN: true }), fc.double({ min: -20, max: 20, noNaN: true }), (b, g) => {
      const a = anglesToTilt(b, g, 0);
      const r = anglesToTilt(b, g, 180);
      assert.ok(Math.abs(a.x + r.x) < 1e-12 && Math.abs(a.y + r.y) < 1e-12);
    }),
  );
});

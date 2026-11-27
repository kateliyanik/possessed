// Property-based tests for the Spirit Board logic (apps/spirit-board/public/spirit.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  BOARD,
  DEFAULTS,
  applyDeadZone,
  createAnswer,
  createDwell,
  createPlanchette,
  glyphAt,
  layoutGlyphs,
} from '../apps/spirit-board/public/spirit.js';

const glyphs = layoutGlyphs();
const byId = new Map(glyphs.map((g) => [g.id, g]));
const unit = fc.double({ min: -1, max: 1, noNaN: true });
// A frame: tilt plus a frame time between 1 ms and 300 ms (slow projectors, hidden tabs).
const frame = fc.tuple(unit, unit, fc.double({ min: 0.001, max: 0.3, noNaN: true }));

// ---------- layout ----------

test('board: 26 letters and 4 words, no capture areas overlap', () => {
  assert.equal(glyphs.filter((g) => g.kind === 'letter').length, 26);
  assert.deepEqual(glyphs.filter((g) => g.kind === 'word').map((g) => g.id), ['YES', 'GOODBYE', 'NO', 'SPACE']);
  for (const a of glyphs) {
    for (const b of glyphs) {
      if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r, `${a.id} overlaps ${b.id}`);
    }
  }
});

test('board: A is at the top, letters run clockwise, every letter is reachable at the rim', () => {
  const a = byId.get('A');
  assert.ok(Math.abs(a.x) < 1e-12 && a.y < 0);
  assert.ok(byId.get('B').x > 0, 'B is to the right of A');
  for (const g of glyphs.filter((x) => x.kind === 'letter')) {
    // The planchette's furthest position in this letter's direction is inside its area.
    const rim = { x: Math.cos(g.angle) * BOARD.limit, y: Math.sin(g.angle) * BOARD.limit };
    assert.equal(glyphAt(rim, glyphs), g);
  }
});

test('board: the centre rest zone chooses nothing', () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: BOARD.restR, noNaN: true }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), (r, a) => {
      assert.equal(glyphAt({ x: r * Math.cos(a), y: r * Math.sin(a) }, glyphs), null);
    }),
  );
});

// ---------- planchette ----------

test('dead zone: small tilts do nothing, full tilt stays full', () => {
  assert.deepEqual(applyDeadZone({ x: 0.05, y: 0.05 }), { x: 0, y: 0 });
  const full = applyDeadZone({ x: 1, y: 0 });
  assert.ok(Math.abs(full.x - 1) < 1e-12);
  assert.deepEqual(applyDeadZone({ x: NaN, y: Infinity }), { x: 0, y: 0 });
});

test('PBT: the planchette never leaves the board and never exceeds the speed cap', () => {
  fc.assert(
    fc.property(fc.array(frame, { minLength: 1, maxLength: 300 }), (frames) => {
      const pl = createPlanchette();
      for (const [x, y, dt] of frames) {
        const s = pl.step(dt, { x, y });
        assert.ok(Math.hypot(s.x, s.y) <= BOARD.limit + 1e-9, `left the board: ${Math.hypot(s.x, s.y)}`);
        assert.ok(s.speed <= DEFAULTS.maxSpeed + 1e-9, `too fast: ${s.speed}`);
        assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
      }
    }),
  );
});

test('PBT: with no input the planchette comes to rest', () => {
  fc.assert(
    fc.property(fc.array(frame, { minLength: 1, maxLength: 100 }), (frames) => {
      const pl = createPlanchette();
      for (const [x, y, dt] of frames) pl.step(dt, { x, y });
      // 10 seconds of a room holding still.
      for (let i = 0; i < 600; i++) pl.step(1 / 60, { x: 0, y: 0 });
      assert.ok(pl.state().speed < 0.01, `still moving at ${pl.state().speed}`);
    }),
  );
});

test('PBT: frame rate does not change where the planchette goes (fixed sub-steps)', () => {
  fc.assert(
    fc.property(unit, unit, (x, y) => {
      const a = createPlanchette({ assist: 0 });
      const b = createPlanchette({ assist: 0 });
      for (let i = 0; i < 120; i++) a.step(1 / 60, { x, y }); // 60 fps for 2 s
      for (let i = 0; i < 40; i++) b.step(1 / 20, { x, y }); // 20 fps for 2 s
      const sa = a.state();
      const sb = b.state();
      assert.ok(Math.hypot(sa.x - sb.x, sa.y - sb.y) < 0.02);
    }),
  );
});

test('pushing towards a letter pins the planchette on it; tilting sideways slides along the ring', () => {
  const pl = createPlanchette();
  for (let i = 0; i < 180; i++) pl.step(1 / 60, { x: 0, y: -0.6 }); // push to the top
  assert.equal(glyphAt(pl.state(), glyphs)?.id, 'A');
  for (let i = 0; i < 60; i++) pl.step(1 / 60, { x: 0.6, y: 0 }); // now push right
  const s = pl.state();
  assert.ok(Math.abs(Math.hypot(s.x, s.y) - BOARD.limit) < 0.05, 'stays near the rim');
  assert.ok(s.x > 0.1, 'moved clockwise along the ring');
});

test('PBT: assist pulls a resting planchette near a glyph onto it; without assist it stays put', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...glyphs),
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
      fc.double({ min: 1.05, max: 1.5, noNaN: true }),
      (g, a, k) => {
        // Start just outside the capture area but inside the magnet's reach.
        const x = g.x + Math.cos(a) * g.r * k;
        const y = g.y + Math.sin(a) * g.r * k;
        if (Math.hypot(x, y) > BOARD.limit) return; // off the board
        const on = createPlanchette();
        const off = createPlanchette({ assist: 0 });
        on.place(x, y);
        off.place(x, y);
        for (let i = 0; i < 180; i++) {
          on.step(1 / 60, { x: 0, y: 0 });
          off.step(1 / 60, { x: 0, y: 0 });
        }
        // It lands on the nearest glyph. Neighbouring letters' pull zones
        // overlap (found by this test), so from a point almost midway it may
        // go either way, but it must never stay stuck between them.
        const landed = glyphAt(on.state(), glyphs);
        assert.ok(landed, `stuck between glyphs near ${g.id}`);
        const ranked = glyphs.map((h) => ({ h, d: Math.hypot(h.x - x, h.y - y) })).sort((p, q) => p.d - q.d);
        if (ranked[1].d - ranked[0].d > 1e-3) assert.equal(landed, ranked[0].h, `went to ${landed.id}, nearest is ${ranked[0].h.id}`);
        assert.ok(Math.hypot(off.state().x - x, off.state().y - y) < 1e-9, 'moved without input or assist');
      },
    ),
  );
});

// ---------- dwell ----------

// A random walk over the board, sampled every dtMs.
const walk = fc.array(
  fc.tuple(fc.constantFrom(...glyphs.map((g) => g.id), 'centre', 'between'), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 10, max: 700 })),
  { minLength: 1, maxLength: 120 },
);

function pointFor(target, jitter) {
  if (target === 'centre') return { x: 0, y: 0 };
  if (target === 'between') {
    // Midway between two letters on the ring: outside every capture area.
    const a = -Math.PI / 2 + Math.PI / 26;
    return { x: BOARD.outerR * Math.cos(a), y: BOARD.outerR * Math.sin(a) };
  }
  const g = byId.get(target);
  // Somewhere inside the glyph's capture area.
  const a = jitter * 2 * Math.PI;
  return { x: g.x + Math.cos(a) * g.r * 0.5 * jitter, y: g.y + Math.sin(a) * g.r * 0.5 * jitter };
}

test('PBT: a glyph is chosen only after continuous dwell, never twice without leaving, never faster than the dwell time', () => {
  fc.assert(
    fc.property(walk, fc.integer({ min: 200, max: 2000 }), (steps, dwellMs) => {
      const dwell = createDwell({ dwellMs, glyphs });
      let now = 0;
      let inside = null;
      let enteredAt = 0;
      let lastChosen = null;
      let leftSinceChosen = true;
      let lastChoiceAt = -Infinity;
      for (const [target, jitter, dtMs] of steps) {
        now += dtMs;
        const p = pointFor(target, jitter);
        const g = glyphAt(p, glyphs);
        if (g !== inside) {
          inside = g;
          enteredAt = now;
        }
        if (lastChosen && Math.hypot(p.x - lastChosen.x, p.y - lastChosen.y) > lastChosen.r * DEFAULTS.rearmFactor) leftSinceChosen = true;

        const r = dwell.update(p, now);
        if (r.chosen) {
          assert.equal(r.chosen, g, 'chose the glyph under the planchette');
          assert.ok(now - enteredAt >= dwellMs, 'held for the full dwell time');
          if (lastChosen === r.chosen) assert.ok(leftSinceChosen, `chose ${r.chosen.id} again without leaving`);
          assert.ok(now - lastChoiceAt >= dwellMs, 'two choices closer than the dwell time');
          lastChosen = r.chosen;
          leftSinceChosen = false;
          lastChoiceAt = now;
        }
        assert.ok(r.progress >= 0 && r.progress <= 1);
      }
    }),
  );
});

test('dwell: disabled never chooses, and enabling does not choose instantly', () => {
  const dwell = createDwell({ dwellMs: 1000 });
  const a = byId.get('A');
  for (let t = 0; t <= 5000; t += 100) assert.equal(dwell.update(a, t, { enabled: false }).chosen, null);
  assert.equal(dwell.update(a, 5100).chosen, null);
  assert.equal(dwell.update(a, 6200).chosen?.id, 'A');
  // Resting there: no repeat.
  for (let t = 6300; t <= 12000; t += 100) assert.equal(dwell.update(a, t).chosen, null);
});

test('dwell: a double letter works by leaving and coming back', () => {
  const dwell = createDwell({ dwellMs: 1000 });
  const l = byId.get('L');
  assert.equal(dwell.update(l, 0).chosen, null);
  assert.equal(dwell.update(l, 1000).chosen?.id, 'L');
  dwell.update({ x: 0, y: 0 }, 1500); // away
  dwell.update(l, 2000);
  assert.equal(dwell.update(l, 3000).chosen?.id, 'L');
});

// ---------- answer ----------

const anyGlyph = fc.constantFrom(...glyphs);

test('PBT: the answer is clean: A–Z and single inner spaces only, at most 24 characters', () => {
  fc.assert(
    fc.property(fc.array(anyGlyph, { maxLength: 80 }), (picks) => {
      const ans = createAnswer();
      let r = ans.result();
      for (const g of picks) {
        const before = r;
        r = ans.add(g);
        if (before.done) assert.deepEqual(r, before, 'nothing changes after the end');
      }
      const final = ans.end();
      assert.ok(final.done);
      assert.ok(final.text.length <= DEFAULTS.maxAnswer, final.text);
      assert.match(final.text, /^([A-Z]+( [A-Z]+)*)?$/, JSON.stringify(final.text));
    }),
  );
});

test('answer: YES or NO alone ends at once; GOODBYE ends; words join with a space', () => {
  const yes = createAnswer();
  assert.deepEqual(yes.add(byId.get('YES')), { text: 'YES', done: true, reason: 'word' });

  const spelled = createAnswer();
  for (const id of ['S', 'P', 'A', 'C', 'E', 'SPACE', 'SPACE', 'O', 'K']) spelled.add(byId.get(id));
  assert.equal(spelled.result().text, 'SPACE OK');
  spelled.add(byId.get('NO'));
  assert.deepEqual(spelled.add(byId.get('GOODBYE')), { text: 'SPACE OK NO', done: true, reason: 'goodbye' });

  const leading = createAnswer();
  leading.add(byId.get('SPACE'));
  leading.add(byId.get('H'));
  assert.equal(leading.result().text, 'H');
});

test('answer: stops at 24 characters', () => {
  const ans = createAnswer();
  let r;
  for (let i = 0; i < 30; i++) r = ans.add(byId.get('B'));
  assert.equal(r.text, 'B'.repeat(24));
  assert.equal(r.reason, 'full');
});

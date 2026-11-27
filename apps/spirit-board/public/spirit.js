// Spirit Board logic: board layout, planchette physics, dwell and answer.
// Pure module (no DOM), shared by the screen page and the tests.
// See .kiro/specs/spirit-board/design.md for the reasoning behind each value.

// Board units: centre (0, 0), board radius 1, y grows downwards like the screen.
export const BOARD = Object.freeze({
  outerR: 0.82, // letter ring
  innerR: 0.45, // word ring
  letterR: 0.085, // capture radius of a letter
  wordR: 0.12, // capture radius of a word
  restR: 0.15, // centre rest zone
  limit: 0.84, // the planchette cannot go further out than this
});

export const DEFAULTS = Object.freeze({
  accel: 2.7, // board units/s² at full tilt
  friction: 3, // 1/s
  assist: 6, // pull towards a nearby glyph, 1/s²
  dwellMs: 1200,
  maxSpeed: 0.9, // board units/s
  deadZone: 0.08, // tilt below this does nothing
  assistSpeed: 0.25, // assist only acts below this speed
  magnetFactor: 1.6, // assist reach, as a multiple of the capture radius
  rearmFactor: 1.6, // leave this far (× capture radius) before a glyph can repeat
  maxAnswer: 24,
});

const STEP = 0.02; // physics sub-step, seconds
const MAX_DT = 0.25; // longer gaps (tab hidden) are not simulated

export const WORDS = Object.freeze(['YES', 'GOODBYE', 'NO', 'SPACE']);

// Letters A–Z clockwise from the top on the outer ring; words on the inner ring.
export function layoutGlyphs() {
  const glyphs = [];
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 26;
    const label = String.fromCharCode(65 + i);
    glyphs.push({ id: label, label, kind: 'letter', x: BOARD.outerR * Math.cos(a), y: BOARD.outerR * Math.sin(a), r: BOARD.letterR, angle: a });
  }
  WORDS.forEach((id, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 2; // top, right, bottom, left
    glyphs.push({ id, label: id, kind: 'word', x: BOARD.innerR * Math.cos(a), y: BOARD.innerR * Math.sin(a), r: BOARD.wordR, angle: a });
  });
  return glyphs;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Removes the dead zone and rescales, so input just past it starts from zero.
export function applyDeadZone(tilt, deadZone = DEFAULTS.deadZone) {
  const x = finite(tilt?.x);
  const y = finite(tilt?.y);
  const m = Math.hypot(x, y);
  if (m <= deadZone) return { x: 0, y: 0 };
  const scale = (Math.min(m, 1) - deadZone) / (1 - deadZone) / m;
  return { x: x * scale, y: y * scale };
}

// The glyph whose capture area contains p (the closest one), or null.
export function glyphAt(p, glyphs) {
  let best = null;
  let bestD = Infinity;
  for (const g of glyphs) {
    const d = dist(p, g);
    if (d <= g.r && d < bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

// ---------- planchette ----------

export function createPlanchette(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const glyphs = options.glyphs || layoutGlyphs();
  const p = { x: 0, y: 0 };
  const v = { x: 0, y: 0 };

  function nearestMagnet() {
    let best = null;
    let bestD = Infinity;
    for (const g of glyphs) {
      const d = dist(p, g);
      if (d <= g.r * o.magnetFactor && d < bestD) {
        best = g;
        bestD = d;
      }
    }
    return best;
  }

  function subStep(h, t) {
    let ax = o.accel * t.x - o.friction * v.x;
    let ay = o.accel * t.y - o.friction * v.y;
    if (o.assist > 0 && Math.hypot(v.x, v.y) < o.assistSpeed) {
      const g = nearestMagnet();
      if (g) {
        ax += o.assist * (g.x - p.x);
        ay += o.assist * (g.y - p.y);
      }
    }
    v.x += ax * h;
    v.y += ay * h;
    const s = Math.hypot(v.x, v.y);
    if (s > o.maxSpeed) {
      v.x *= o.maxSpeed / s;
      v.y *= o.maxSpeed / s;
    }
    p.x += v.x * h;
    p.y += v.y * h;
    // Hold the planchette on the rim and remove the outward part of its speed,
    // so pushing outwards pins it to the letter ring and sideways slides it.
    const r = Math.hypot(p.x, p.y);
    if (r > BOARD.limit) {
      const ux = p.x / r;
      const uy = p.y / r;
      p.x = ux * BOARD.limit;
      p.y = uy * BOARD.limit;
      const out = v.x * ux + v.y * uy;
      if (out > 0) {
        v.x -= out * ux;
        v.y -= out * uy;
      }
    }
  }

  // Advances the simulation by dt seconds with the room's tilt.
  function step(dt, tilt) {
    if (!(dt > 0)) return state();
    const total = Math.min(dt, MAX_DT);
    const n = Math.ceil(total / STEP);
    const t = applyDeadZone(tilt, o.deadZone);
    for (let i = 0; i < n; i++) subStep(total / n, t);
    return state();
  }

  function state() {
    return { x: p.x, y: p.y, vx: v.x, vy: v.y, speed: Math.hypot(v.x, v.y) };
  }

  return {
    step,
    state,
    // Stop at once (for the reveal).
    halt() {
      v.x = 0;
      v.y = 0;
    },
    // Put the planchette at rest at a point (kept on the board).
    place(x, y) {
      const r = Math.hypot(finite(x), finite(y));
      const k = r > BOARD.limit ? BOARD.limit / r : 1;
      p.x = finite(x) * k;
      p.y = finite(y) * k;
      v.x = 0;
      v.y = 0;
    },
    // Back to the centre (for a new séance).
    reset() {
      p.x = 0;
      p.y = 0;
      v.x = 0;
      v.y = 0;
    },
    options: o,
  };
}

// ---------- dwell ----------

// Chooses a glyph when the planchette rests on it for dwellMs. A chosen glyph
// cannot be chosen again until the planchette has moved clearly away from it.
export function createDwell(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const glyphs = options.glyphs || layoutGlyphs();
  let hover = null;
  let since = 0;
  let blocked = null;

  // now is in milliseconds. enabled=false (practice, reveal) never chooses
  // and keeps restarting the timer, so enabling it never chooses instantly.
  function update(p, now, { enabled = true } = {}) {
    if (blocked && dist(p, blocked) > blocked.r * o.rearmFactor) blocked = null;
    const g = glyphAt(p, glyphs);
    if (g !== hover) {
      hover = g;
      since = now;
    }
    if (!enabled || !hover || hover === blocked) {
      if (!enabled) since = now;
      return { hover, progress: 0, chosen: null };
    }
    const held = now - since;
    if (held >= o.dwellMs) {
      blocked = hover;
      return { hover, progress: 1, chosen: hover };
    }
    return { hover, progress: Math.max(0, held / o.dwellMs), chosen: null };
  }

  return {
    update,
    reset() {
      hover = null;
      blocked = null;
      since = 0;
    },
  };
}

// ---------- answer ----------

// Builds the answer from chosen glyphs. Returns { text, done, reason }.
export function createAnswer({ max = DEFAULTS.maxAnswer } = {}) {
  let text = '';
  let done = false;
  let reason = null;

  function finish(why) {
    done = true;
    reason = why;
    text = text.trim();
  }

  function add(glyph) {
    if (done || !glyph) return result();
    if (glyph.kind === 'letter') {
      if (text.length < max) text += glyph.label;
    } else if (glyph.id === 'SPACE') {
      if (text.length > 0 && !text.endsWith(' ') && text.length < max) text += ' ';
    } else if (glyph.id === 'YES' || glyph.id === 'NO') {
      if (text.trim() === '') {
        text = glyph.id;
        finish('word');
        return result();
      }
      const piece = (text.endsWith(' ') ? '' : ' ') + glyph.id;
      if (text.length + piece.length <= max) text += piece;
      else finish('full');
    } else if (glyph.id === 'GOODBYE') {
      finish('goodbye');
      return result();
    }
    if (!done && text.length >= max) finish('full');
    return result();
  }

  function result() {
    return { text: done ? text : text.trimStart(), done, reason };
  }

  return {
    add,
    result,
    // End early (host pressed End).
    end() {
      if (!done) finish('host');
      return result();
    },
  };
}

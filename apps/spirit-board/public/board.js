// Spirit Board screen: draws the board, runs the séance and tells phones what
// to show. Logic lives in spirit.js; the room comes from the PossessionKit SDK.
import { createScreen } from '/kit/client/screen-sdk.js';
import { BOARD, DEFAULTS, layoutGlyphs, createPlanchette, createDwell, createAnswer } from './spirit.js';
import { createSound } from './sound.js';
const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const APP = 'spirit-board';
const PRESETS = ['Is anyone there?', 'Who is in this room?', 'Will we win?', 'What should we do next?'];
const DEFAULT_QUESTION = 'Is anyone there?';
const MAX_CANDLES = 16;
const ACTIVE_MS = 800; // a phone counts as steering this long after its last input
const REJOIN_MS = 2500; // a rejoined candle flickers this long
// ---------- tuning from the URL (Req 2.6) ----------
const query = new URLSearchParams(location.search);
function param(name, fallback, min, max) {
  const raw = query.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
const tuning = {
  accel: param('accel', DEFAULTS.accel, 0.2, 12),
  friction: param('friction', DEFAULTS.friction, 0.5, 12),
  assist: param('assist', DEFAULTS.assist, 0, 30),
  dwellMs: param('dwell', DEFAULTS.dwellMs / 1000, 0.3, 6) * 1000,
};
// ---------- state ----------
const glyphs = layoutGlyphs();
const plan = createPlanchette({ ...tuning, glyphs });
const dwell = createDwell({ dwellMs: tuning.dwellMs, glyphs });
let answer = createAnswer();
let phase = 'practice';
let question = '';
let revealText = '';
let lastSpelled = '';
const sound = createSound();
// ---------- SVG helpers ----------
function svg(name, attrs = {}, parent) {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}
const boardEl = $('board');
const glyphEls = new Map(); // id -> { g, ring }
let planchetteEl;
let candleLayer;
function buildBoard() {
  const defs = svg('defs', {}, boardEl);
  const wood = svg('radialGradient', { id: 'wood', cx: '45%', cy: '40%', r: '70%' }, defs);
  svg('stop', { offset: '0%', 'stop-color': '#2b1b26' }, wood);
  svg('stop', { offset: '100%', 'stop-color': '#120a14' }, wood);
  const glow = svg('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  svg('feGaussianBlur', { stdDeviation: 0.018, result: 'b' }, glow);
  const merge = svg('feMerge', {}, glow);
  svg('feMergeNode', { in: 'b' }, merge);
  svg('feMergeNode', { in: 'SourceGraphic' }, merge);
  svg('circle', { class: 'board-face', r: 1 }, boardEl);
  svg('circle', { class: 'ring-line', r: 0.93 }, boardEl);
  svg('circle', { class: 'ring-line', r: 0.71 }, boardEl);
  svg('circle', { class: 'ring-dash', r: 0.45 }, boardEl);
  svg('circle', { class: 'eye', r: BOARD.restR }, boardEl);
  svg('circle', { class: 'eye', r: BOARD.restR * 0.45 }, boardEl);
  // Small ticks between the letters.
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / 26;
    svg('line', { class: 'tick', x1: Math.cos(a) * 0.9, y1: Math.sin(a) * 0.9, x2: Math.cos(a) * 0.96, y2: Math.sin(a) * 0.96 }, boardEl);
  }
  for (const gl of glyphs) {
    const g = svg('g', { class: `glyph ${gl.kind}` }, boardEl);
    const ring = svg('circle', { class: 'progress', cx: gl.x, cy: gl.y, r: gl.r, pathLength: 1 }, g);
    const text = svg('text', { x: gl.x, y: gl.y }, g);
    text.textContent = gl.label;
    glyphEls.set(gl.id, { g, ring });
  }
  candleLayer = svg('g', { class: 'candles' }, boardEl);
  planchetteEl = svg('g', { id: 'planchette' }, boardEl);
  svg('circle', { class: 'planchette-body', r: 0.075 }, planchetteEl);
  svg('circle', { class: 'planchette-lens', r: 0.045 }, planchetteEl);
  svg('circle', { class: 'planchette-eye', r: 0.012 }, planchetteEl);
}
buildBoard();
// ---------- candles: one per connected phone (Req 6.1) ----------
const candles = new Map(); // player id -> element
const moreEl = svg('text', { class: 'more', x: 0, y: 1.27 }, boardEl);
function slotPosition(i) {
  const a = Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / MAX_CANDLES;
  return { x: Math.cos(a) * 1.14, y: Math.sin(a) * 1.14 };
}
function renderCandles(players) {
  const online = players.filter((p) => p.online);
  const shown = online.slice(0, MAX_CANDLES);
  const keep = new Set(shown.map((p) => p.id));
  for (const [id, el] of candles) {
    if (!keep.has(id)) {
      el.remove();
      candles.delete(id);
    }
  }
  shown.forEach((p, i) => {
    let el = candles.get(p.id);
    if (!el) {
      el = svg('g', { class: 'candle idle' }, candleLayer);
      svg('rect', { x: -0.02, y: -0.01, width: 0.04, height: 0.09, rx: 0.006 }, el);
      svg('ellipse', { class: 'flame', cx: 0, cy: -0.045, rx: 0.017, ry: 0.034 }, el);
      candles.set(p.id, el);
    }
    const pos = slotPosition(i);
    el.setAttribute('transform', `translate(${pos.x.toFixed(4)} ${pos.y.toFixed(4)})`);
  });
  const extra = online.length - shown.length;
  moreEl.textContent = extra > 0 ? `+${extra} more` : '';
  $('count').textContent = `${online.length} ${online.length === 1 ? 'candle' : 'candles'} lit`;
}
function updateCandles(now) {
  const byId = new Map(screen.players().map((p) => [p.id, p]));
  for (const [id, el] of candles) {
    const p = byId.get(id);
    if (!p) continue;
    const active = now - p.lastInputAt < ACTIVE_MS;
    const rejoin = p.joins > 1 && now - p.lastJoinAt < REJOIN_MS;
    el.classList.toggle('active', active && !rejoin);
    el.classList.toggle('rejoin', rejoin);
    el.classList.toggle('idle', !active && !rejoin);
  }
}
// ---------- screen and phone controls ----------
function currentUi() {
  if (phase === 'seance') {
    const so = answer.result().text;
    return { mode: 'tilt', prompt: `${question} · so far: ${so || '…'}`, round: 0 };
  }
  if (phase === 'reveal') {
    return { mode: 'wait', prompt: revealText ? `The spirits answered: ${revealText}` : 'The spirits stayed silent.', round: 0 };
  }
  return { mode: 'tilt', prompt: 'Practice: move the planchette together', round: 0 };
}
function sendUi() {
  screen.broadcast({ ui: currentUi() }, { force: true });
}
const screen = createScreen({
  onRoom({ room, joinUrl }) {
    $('room').textContent = room;
    $('joinUrl').textContent = joinUrl;
    $('qr').src = screen.qrUrl(APP);
    // After a screen reload the server still holds the old state: send ours.
    sendUi();
  },
  onPlayers: renderCandles,
});
// ---------- phases (Req 4) ----------
function setPhase(next) {
  phase = next;
  document.body.className = `phase-${next}`;
  $('hostPractice').hidden = next !== 'practice';
  $('hostSeance').hidden = next !== 'seance';
  $('hostReveal').hidden = next !== 'reveal';
  $('reveal').hidden = next !== 'reveal';
  $('phaseLabel').textContent = { practice: 'Practice', seance: 'Séance', reveal: 'The answer' }[next];
}
function showSpelled() {
  const text = answer.result().text;
  lastSpelled = text;
  $('spelled').textContent = text;
}
function startPractice() {
  setPhase('practice');
  answer = createAnswer();
  dwell.reset();
  plan.reset();
  question = '';
  revealText = '';
  $('questionText').textContent = 'Move the planchette together';
  $('spelled').textContent = '';
  sendUi();
  $('question').focus();
}
function beginSeance() {
  question = $('question').value.trim() || DEFAULT_QUESTION;
  answer = createAnswer();
  dwell.reset();
  plan.reset();
  setPhase('seance');
  $('questionText').textContent = question;
  showSpelled();
  sendUi();
}
function startReveal() {
  const result = answer.end();
  revealText = result.text;
  plan.halt();
  setPhase('reveal');
  const box = $('answer');
  box.textContent = '';
  box.classList.toggle('silent', revealText === '');
  if (revealText === '') {
    box.textContent = 'The spirits stayed silent';
  } else {
    Array.from(revealText).forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch === ' ' ? '\u00a0' : ch;
      s.style.animationDelay = `${0.4 + i * 0.45}s`;
      box.append(s);
    });
  }
  sound.reveal();
  sendUi();
}
$('sound').addEventListener('click', () => {
  const on = sound.setEnabled(!sound.enabled);
  $('sound').setAttribute('aria-pressed', String(on));
  $('sound').textContent = on ? 'Sound: on' : 'Sound: off';
});
$('begin').addEventListener('click', beginSeance);
$('end').addEventListener('click', startReveal);
$('cancel').addEventListener('click', startPractice);
$('again').addEventListener('click', startPractice);
$('question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') beginSeance();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && phase === 'seance') startPractice();
});
for (const text of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', () => {
    $('question').value = text;
    $('question').focus();
  });
  $('presets').append(b);
}
// ---------- frame loop ----------
let lastFrame = performance.now();
let lastHover = null;
let lastPanel = 0;
let agreeShown = 0;
function frame(now) {
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const tilt = screen.tilt();
  const pos = phase === 'reveal' ? plan.state() : plan.step(dt, tilt);
  planchetteEl.setAttribute('transform', `translate(${pos.x.toFixed(4)} ${pos.y.toFixed(4)})`);
  const d = dwell.update(pos, now, { enabled: phase === 'seance' });
  // Dwell progress on the hovered glyph (Req 3.2).
  if (lastHover && lastHover !== d.hover) glyphEls.get(lastHover.id).ring.style.strokeDasharray = '0 1';
  if (d.hover) {
    const el = glyphEls.get(d.hover.id);
    el.ring.style.strokeDasharray = `${d.progress.toFixed(3)} 1`;
    el.g.classList.add('hover');
  }
  for (const [id, el] of glyphEls) if (!d.hover || d.hover.id !== id) el.g.classList.remove('hover');
  lastHover = d.hover;
  if (d.chosen) {
    const el = glyphEls.get(d.chosen.id);
    el.ring.style.strokeDasharray = '0 1';
    el.g.classList.remove('chosen');
    void el.g.getBoundingClientRect(); // restart the animation
    el.g.classList.add('chosen');
    sound.chime(glyphs.indexOf(d.chosen));
    const result = answer.add(d.chosen);
    if (result.text !== lastSpelled) {
      showSpelled();
      sendUi();
    }
    if (result.done) startReveal();
  }
  updateCandles(now);
  if (now - lastPanel > 120) {
    lastPanel = now;
    updatePanel(now);
  }
  requestAnimationFrame(frame);
}
function updatePanel(now) {
  const steering = screen.players().filter((p) => p.online && now - p.lastInputAt < 1000).length;
  const target = steering > 0 ? screen.coherence() : 0;
  agreeShown += (target - agreeShown) * 0.5;
  $('agree').style.width = `${Math.round(agreeShown * 100)}%`;
  $('agreeText').textContent =
    steering === 0
      ? 'Nobody is steering yet'
      : steering === 1
        ? 'One phone is steering'
        : `${steering} phones steering, ${Math.round(target * 100)}% pulling the same way`;
}
setPhase('practice');
requestAnimationFrame(frame);

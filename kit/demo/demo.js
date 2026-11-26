// Feasibility screen for Pit Stop 1. Shows the crowd dot, each phone's link
// quality and a pass/fail checklist for the go/no-go decision.

import { createScreen } from '/kit/client/screen-sdk.js';

const $ = (id) => document.getElementById(id);
const TEN_MIN = 10 * 60 * 1000;
const RTT_TARGET = 150;

const screen = createScreen({
  onRoom({ room, joinUrl }) {
    $('room').textContent = room;
    $('joinUrl').textContent = joinUrl;
    $('qr').src = screen.qrUrl();
    // Tell phones which controls to show. After a screen reload the server
    // still holds the previous state, so always send the current one.
    screen.broadcast({ ui: currentUi }, { force: true });
  },
  onStatus(s) {
    $('status').textContent =
      s.state === 'open' ? 'Screen connected' : s.state === 'stopped' ? `Stopped (${s.reason})` : 'Reconnecting…';
  },
  onPlayers: () => {},
  onInput(msg) {
    seenKinds.add(msg.kind);
    if (msg.kind === 'tap') tapTotal++;
  },
});

// ---------- control modes ----------

const seenKinds = new Set();
let tapTotal = 0;
let round = 0;
const DEMO_OPTIONS = ['A haunted lighthouse', 'A cursed library', 'A silent train station'];
const MODES = {
  tilt: () => ({ mode: 'tilt', prompt: 'Tilt together to move the spirit.' }),
  choice: () => ({ mode: 'choice', prompt: 'Where should the spirit go next?', options: DEMO_OPTIONS, round }),
  tap: () => ({ mode: 'tap', prompt: 'Tap to wake the spirit.' }),
  shake: () => ({ mode: 'shake', prompt: 'Shake to stir the spirit.' }),
};
let currentUi = MODES.tilt();

function setMode(name) {
  round++;
  currentUi = MODES[name]();
  screen.broadcast({ ui: currentUi }, { force: true });
  for (const b of document.querySelectorAll('.modes button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === name));
  }
  $('modeView').hidden = name === 'tilt';
  $('field').style.visibility = name === 'tilt' ? 'visible' : 'hidden';
  renderModeView();
}
for (const b of document.querySelectorAll('.modes button')) {
  b.addEventListener('click', () => setMode(b.dataset.mode));
}

const CONTROL_CHECKS = [
  { label: 'A choice arrived', test: () => seenKinds.has('choice') },
  { label: 'A tap arrived', test: () => seenKinds.has('tap') },
  { label: 'A shake arrived', test: () => seenKinds.has('shake') },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderModeView() {
  const view = $('modeView');
  const online = screen.online().length;
  if (currentUi.mode === 'choice') {
    const t = screen.tally(currentUi.round, currentUi.options.length);
    const rows = currentUi.options.map((label, i) => {
      const row = el('div', `bar${t.leader === i ? ' lead' : ''}`);
      const track = el('div', 'track');
      const fill = el('div', 'fill');
      fill.style.width = `${t.total ? (t.counts[i] / t.total) * 100 : 0}%`;
      track.append(fill);
      row.append(el('span', '', label), track, el('span', '', String(t.counts[i])));
      return row;
    });
    view.replaceChildren(el('p', 'label', `${t.total} of ${online} phones voted`), ...rows);
  } else if (currentUi.mode === 'tap') {
    view.replaceChildren(
      el('p', 'big', String(screen.taps(1500))),
      el('p', 'label', `phones tapping now · ${tapTotal} taps in total`),
    );
  } else if (currentUi.mode === 'shake') {
    const s = screen.shake(online);
    const row = el('div', 'bar lead');
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = `${Math.round(s.energy * 100)}%`;
    track.append(fill);
    row.append(el('span', '', 'Room energy'), track, el('span', '', `${Math.round(s.energy * 100)}%`));
    view.replaceChildren(
      el('p', 'big', `${s.n}`),
      el('p', 'label', `phones shaking · strongest ${Math.round(s.peak * 100)}%`),
      row,
    );
  }
}

// Show the https warning whenever the page itself is not on https.
$('httpsWarn').hidden = location.protocol === 'https:';

// ---------- checklist state ----------

const seen = { maxOnline: 0, devices: new Set() };
let twoPlusSince = null;
let twoPlusBest = 0;
const startedAt = Date.now();

const CHECKS = [
  { id: 'two', label: 'Two or more phones connected', test: () => seen.maxOnline >= 2, detail: () => `max ${seen.maxOnline}` },
  { id: 'ios', label: 'An iPhone joined', test: () => seen.devices.has('ios') },
  { id: 'android', label: 'An Android phone joined', test: () => seen.devices.has('android') },
  { id: 'move', label: 'Phones moved the spirit', test: () => movedFar, detail: () => (movedFar ? '' : 'tilt to an edge') },
  { id: 'rejoin', label: 'A phone rejoined by itself', test: () => screen.rejoins() >= 1, detail: () => `${screen.rejoins()} rejoins` },
  {
    id: 'ten',
    label: '10 minutes with 2+ phones',
    test: () => twoPlusBest >= TEN_MIN,
    detail: () => `${fmtMin(Math.max(twoPlusBest, twoPlusSince ? Date.now() - twoPlusSince : 0))} / 10:00`,
  },
  {
    id: 'rtt',
    label: `Median round trip under ${RTT_TARGET} ms`,
    test: () => medianRtt() !== null && medianRtt() < RTT_TARGET,
    detail: () => (medianRtt() === null ? 'no data' : `${Math.round(medianRtt())} ms`),
  },
];

let movedFar = false;

function onlinePlayers() {
  return screen.players().filter((p) => p.online);
}

function medianRtt() {
  const values = onlinePlayers()
    .map((p) => p.rtt)
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function fmtMin(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderChecks() {
  const list = $('checks');
  list.replaceChildren(
    ...CHECKS.map((c) => {
      const li = document.createElement('li');
      const pass = c.test();
      li.className = pass ? 'pass' : '';
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = pass ? '✓' : '○';
      const label = document.createElement('span');
      label.textContent = c.label;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = c.detail ? c.detail() : '';
      li.append(mark, label, detail);
      return li;
    }),
  );
  const passed = CHECKS.filter((c) => c.test()).length;
  const verdict = $('verdict');
  if (passed === CHECKS.length) {
    verdict.textContent = 'PASS: tilt control is viable. Record this in PIT-STOPS.md.';
    verdict.className = 'verdict pass';
  } else {
    verdict.textContent = `${passed} of ${CHECKS.length} checks passed`;
    verdict.className = 'verdict';
  }
}

function renderPhones(shares) {
  const rows = screen
    .players()
    .slice()
    .sort((a, b) => Number(b.online) - Number(a.online) || a.id.localeCompare(b.id))
    .map((p) => {
      const tr = document.createElement('tr');
      if (!p.online) tr.className = 'offline';
      const cells = [
        p.id.slice(0, 7),
        p.device,
        p.online ? (p.rtt === null ? '…' : `${p.rtt} ms`) : 'offline',
        p.online ? String(p.hz ?? 0) : '',
        String(p.joins),
        shares.has(p.id) ? `${Math.round(shares.get(p.id) * 100)}%` : '',
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text; // phone-supplied values are rendered as text only
        tr.append(td);
      }
      return tr;
    });
  $('phoneRows').replaceChildren(...rows);
  const n = onlinePlayers().length;
  $('count').textContent = `${n} phone${n === 1 ? '' : 's'}`;
}

function updateSeen() {
  const online = onlinePlayers();
  seen.maxOnline = Math.max(seen.maxOnline, online.length);
  for (const p of online) seen.devices.add(p.device);
  const now = Date.now();
  if (online.length >= 2) {
    if (twoPlusSince === null) twoPlusSince = now;
    twoPlusBest = Math.max(twoPlusBest, now - twoPlusSince);
  } else {
    twoPlusSince = null;
  }
}

// ---------- drawing ----------

const canvas = $('field');
const ctx = canvas.getContext('2d');
const spirit = { x: 0, y: 0 };
const trail = [];

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

function frame() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const r = Math.min(w, h) * 0.42;
  const cx = w / 2;
  const cy = h / 2;

  const t = screen.tilt();
  // Ease toward the crowd's mean so the spirit glides instead of jitters.
  spirit.x += (t.x - spirit.x) * 0.18;
  spirit.y += (t.y - spirit.y) * 0.18;
  if (Math.hypot(spirit.x, spirit.y) > 0.8) movedFar = true;
  trail.push({ x: spirit.x, y: spirit.y });
  if (trail.length > 60) trail.shift();

  ctx.clearRect(0, 0, w, h);

  // Boundary ring.
  ctx.strokeStyle = '#3a2a40';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Trail.
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    ctx.fillStyle = `rgba(155, 231, 216, ${(i / trail.length) * 0.25})`;
    ctx.beginPath();
    ctx.arc(cx + p.x * r, cy + p.y * r, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // The combined spirit.
  const sx = cx + spirit.x * r;
  const sy = cy + spirit.y * r;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
  glow.addColorStop(0, 'rgba(155, 231, 216, 0.9)');
  glow.addColorStop(1, 'rgba(155, 231, 216, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8fffa';
  ctx.beginPath();
  ctx.arc(sx, sy, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#a79c8f';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`${t.n} phone${t.n === 1 ? '' : 's'} steering`, 16, h - 16);

  requestAnimationFrame(frame);
}

// ---------- slow updates ----------

setInterval(() => {
  updateSeen();
  const shares = new Map(screen.influence().map(({ id, share }) => [id, share]));
  renderPhones(shares);
  renderChecks();
  renderControlChecks();
}, 500);
setInterval(() => {
  if (currentUi.mode !== 'tilt') renderModeView();
}, 200);

function renderControlChecks() {
  $('controlChecks').replaceChildren(
    ...CONTROL_CHECKS.map((c) => {
      const pass = c.test();
      const li = el('li', pass ? 'pass' : '');
      li.append(el('span', 'mark', pass ? '✓' : '○'), el('span', '', c.label), el('span', 'detail', ''));
      return li;
    }),
  );
}

// For the automated browser test (test/browser/smoke.mjs). Read-only views.
window.__possessed = Object.freeze({
  room: () => screen.room,
  tilt: () => screen.tilt(),
  online: () => screen.online().length,
  tally: () => screen.tally(currentUi.round, currentUi.options?.length ?? 0),
  taps: () => tapTotal,
  shake: () => screen.shake(screen.online().length),
  seen: () => [...seenKinds],
});

$('copy').addEventListener('click', async () => {
  const lines = [
    `POSSESSED Pit Stop 1 result (${new Date().toISOString()})`,
    `Page: ${location.origin}`,
    `Test length: ${fmtMin(Date.now() - startedAt)}`,
    ...CHECKS.map((c) => `${c.test() ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? ` (${c.detail()})` : ''}`),
    'Other controls (optional):',
    ...CONTROL_CHECKS.map((c) => `  ${c.test() ? 'PASS' : '----'}  ${c.label}`),
    'Phones:',
    ...screen.players().map((p) => `  ${p.id.slice(0, 7)} ${p.device} joins=${p.joins} rtt=${p.rtt ?? '-'} hz=${p.hz ?? '-'}`),
  ];
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    $('copy').textContent = 'Copied';
  } catch {
    $('copy').textContent = 'Copy failed';
  }
  setTimeout(() => ($('copy').textContent = 'Copy results'), 1500);
});
$('newRoom').addEventListener('click', () => screen.reset());

resize();
requestAnimationFrame(frame);

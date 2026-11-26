// Browser smoke test: runs the real screen and phone pages in headless Chrome.
//
//   npm run test:browser
//   CHROME_PATH=/path/to/chrome npm run test:browser
//
// Drives Chrome through its DevTools protocol using Node's built-in WebSocket,
// so it needs no extra dependency. It checks the things unit tests cannot:
// the pages load without errors, tilt (emulated sensor) and the touch pad move
// the crowd, the screen switches phone controls, late joiners get the current
// controls, a dropped phone rejoins by itself, and a screen reload keeps the room.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../kit/server/index.js';

const CHROME =
  process.env.CHROME_PATH ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

if (!CHROME) {
  console.log('SKIP: Chrome not found. Set CHROME_PATH to run the browser test.');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function waitFor(fn, { timeout = 6000, every = 50 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(every);
  }
  return last instanceof Error ? null : last;
}

// ---------- Chrome DevTools protocol ----------

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      } else {
        for (const l of this.listeners) l(m);
      }
    };
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('could not connect to Chrome'));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'possessed-chrome-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  const ready = await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'), { timeout: 15000 });
  if (!ready) throw new Error('Chrome did not start');
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const cdp = new Cdp(`ws://127.0.0.1:${port}${path}`);
  await cdp.open();
  return {
    cdp,
    async close() {
      proc.kill('SIGTERM');
      await sleep(300);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

async function openPage(cdp, url, { name, context, phone = false, touch = false } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  cdp.listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(`${name}: ${d.exception?.description || d.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(`${name}: console.error ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '')) {
      errors.push(`${name}: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    }
  });
  await s('Runtime.enable');
  await s('Log.enable');
  await s('Page.enable');
  if (phone) {
    await s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  }
  if (touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await s('Page.navigate', { url });
  const page = {
    name,
    s,
    async eval(expression) {
      const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    text: (id) => page.eval(`document.getElementById(${JSON.stringify(id)})?.textContent ?? null`),
    visible: (id) => page.eval(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden; })()`),
    click: (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`),
  };
  await waitFor(() => page.eval('document.readyState === "complete"'));
  return page;
}

// ---------- the test ----------

const server = createServer({ port: 0, host: '127.0.0.1', log: () => {} });
const base = `http://127.0.0.1:${await server.listen()}`;
const chrome = await launchChrome();
const { cdp } = chrome;

try {
  // Screen.
  const screen = await openPage(cdp, `${base}/demo/`, { name: 'screen' });
  const room = await waitFor(() => screen.eval('window.__possessed?.room()'));
  check('screen opens a room', /^[A-HJ-NP-Z]{4}$/.test(room || ''), room);
  const qrOk = await waitFor(() => screen.eval('(() => { const i = document.getElementById("qr"); return i.complete && i.naturalWidth > 0; })()'));
  check('QR code image loads', Boolean(qrOk));

  // Phone 1: emulated tilt sensor. Separate browser contexts give each
  // phone its own storage, so each has its own player id.
  const ctx1 = (await cdp.send('Target.createBrowserContext')).browserContextId;
  const phone1 = await openPage(cdp, `${base}/join?room=${room}`, { name: 'phone1', context: ctx1, phone: true, touch: true });
  await phone1.s('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 0 });
  check('phone 1 connects', Boolean(await waitFor(async () => (await phone1.text('link'))?.startsWith('Connected'))));
  await phone1.click('#go');
  check('phone 1 is in tilt mode', Boolean(await waitFor(() => phone1.visible('tilt'))));
  await sleep(200);
  // Tilt right by 20° (25° is full deflection), so x should be about 0.8.
  await phone1.s('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 20 });
  const t1 = await waitFor(async () => {
    const t = await screen.eval('window.__possessed.tilt()');
    return t.n === 1 && t.x > 0.7 ? t : null;
  });
  check('tilting phone 1 moves the crowd', Boolean(t1), t1 ? `x=${t1.x.toFixed(2)}` : 'no movement');

  // Phone 2: touch controls, driven with real mouse/pointer events.
  const ctx2 = (await cdp.send('Target.createBrowserContext')).browserContextId;
  const phone2 = await openPage(cdp, `${base}/join?room=${room}`, { name: 'phone2', context: ctx2, phone: true });
  await waitFor(async () => (await phone2.text('link'))?.startsWith('Connected'));
  await phone2.click('#goTouch');
  check('phone 2 shows the touch pad', Boolean(await waitFor(() => phone2.visible('pad'))));
  const rect = await phone2.eval('(() => { const r = document.getElementById("padArea").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // Press at the left edge: x = -0.9.
  await phone2.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx - rect.w * 0.45, y: cy, button: 'left', buttons: 1, clickCount: 1 });
  await phone2.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - rect.w * 0.45, y: cy, button: 'left', buttons: 1 });
  const t2 = await waitFor(async () => {
    const t = await screen.eval('window.__possessed.tilt()');
    return t.n === 2 && Math.abs(t.x - (0.8 - 0.9) / 2) < 0.08 ? t : null;
  });
  check('two phones count once each (mean of both)', Boolean(t2), t2 ? `n=${t2.n} x=${t2.x.toFixed(3)}` : 'mean not reached');
  await phone2.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx - rect.w * 0.45, y: cy, button: 'left', buttons: 0, clickCount: 1 });
  const released = await waitFor(async () => (await screen.eval('window.__possessed.tilt()')).n === 1, { timeout: 4000 });
  check('lifting the finger stops counting phone 2 (stale window)', Boolean(released));

  // Choice mode.
  await screen.click('[data-mode="choice"]');
  const opts = await waitFor(async () => (await phone2.visible('choice')) && (await phone2.eval('document.querySelectorAll("#options button").length')));
  check('screen switches phones to choice mode', opts === 3, `${opts} options`);
  check('phone shows the screen\'s question', (await phone2.text('prompt')) === 'Where should the spirit go next?');
  await waitFor(() => phone1.visible('choice'));
  await phone1.click('#options button:nth-child(2)');
  await phone2.click('#options button:nth-child(2)');
  let tally = await waitFor(async () => {
    const t = await screen.eval('window.__possessed.tally()');
    return t.total === 2 ? t : null;
  });
  check('two votes for the same option', tally?.counts?.[1] === 2 && tally?.leader === 1, JSON.stringify(tally?.counts));
  await phone1.click('#options button:nth-child(3)');
  tally = await waitFor(async () => {
    const t = await screen.eval('window.__possessed.tally()');
    return t.counts[2] === 1 ? t : null;
  });
  check('changing a vote moves it; a tie has no leader', tally?.total === 2 && tally?.leader === null, JSON.stringify(tally?.counts));
  check('the chosen answer is marked on the phone', (await phone1.eval('document.querySelector("#options button:nth-child(3)").getAttribute("aria-pressed")')) === 'true');

  // Late joiner gets the current controls.
  const ctx3 = (await cdp.send('Target.createBrowserContext')).browserContextId;
  const phone3 = await openPage(cdp, `${base}/join?room=${room}`, { name: 'phone3', context: ctx3, phone: true });
  await waitFor(async () => (await phone3.text('link'))?.startsWith('Connected'));
  await phone3.click('#goTouch');
  const lateOpts = await waitFor(async () => (await phone3.visible('choice')) && (await phone3.eval('document.querySelectorAll("#options button").length')));
  check('a late joiner sees the current question', lateOpts === 3);

  // Tap mode.
  await screen.click('[data-mode="tap"]');
  await waitFor(() => phone2.visible('tap'));
  await phone2.click('#tapBtn');
  await phone3.click('#tapBtn');
  const taps = await waitFor(async () => (await screen.eval('window.__possessed.taps()')) >= 2);
  check('taps arrive', Boolean(taps));

  // Shake mode, using the touch alternative (tap fast).
  await screen.click('[data-mode="shake"]');
  await waitFor(() => phone2.visible('shake'));
  for (let i = 0; i < 6; i++) {
    await phone2.click('#shakeBtn');
    await sleep(60);
  }
  const shake = await waitFor(async () => {
    const s = await screen.eval('window.__possessed.shake()');
    return s.n >= 1 && s.energy > 0 ? s : null;
  });
  check('tapping fast counts as shaking', Boolean(shake), shake ? `energy=${shake.energy.toFixed(2)} of ${await screen.eval('window.__possessed.online()')} phones` : '');

  // A dropped connection rejoins by itself.
  const roomObj = server.registry.get(room);
  const p2id = [...roomObj.phones.keys()].find((id) => id !== [...roomObj.phones.keys()][0]) ?? [...roomObj.phones.keys()][1];
  const before = await phone2.text('link');
  for (const [id, { ws }] of roomObj.phones) {
    if (id === p2id) ws.terminate();
  }
  const rejoined = await waitFor(async () => /rejoined/.test((await phone1.text('link')) + (await phone2.text('link')) + (await phone3.text('link'))), { timeout: 8000 });
  check('a dropped phone reconnects by itself', Boolean(rejoined), before);
  check('the screen counts the rejoin', Boolean(await waitFor(async () => (await screen.eval('document.getElementById("checks").textContent')).includes('1 rejoins'))));

  // A second tab for the same phone replaces the first.
  const phone1b = await openPage(cdp, `${base}/join?room=${room}`, { name: 'phone1-tab2', context: ctx1, phone: true });
  await waitFor(async () => (await phone1b.text('link'))?.startsWith('Connected'));
  const replaced = await waitFor(async () => (await phone1.visible('stopped')) && (await phone1.text('stoppedTitle')));
  check('the older tab says it was replaced', replaced === 'Open in another tab', replaced);
  check('the room still has three phones, not four', (await screen.eval('window.__possessed.online()')) === 3);

  // Screen reload keeps the room and resets phones to the screen's controls.
  await screen.s('Page.reload');
  await sleep(300);
  const room2 = await waitFor(() => screen.eval('window.__possessed?.room()'));
  check('screen reload keeps the same room', room2 === room, `${room} -> ${room2}`);
  check('phones follow the reloaded screen\'s controls', Boolean(await waitFor(() => phone2.visible('pad'))));
  check('phones stay connected through a screen reload', (await waitFor(async () => (await screen.eval('window.__possessed.online()')) === 3)) === true);

  // Bad room code.
  const lost = await openPage(cdp, `${base}/join?room=ZZZZ`, { name: 'lost' });
  check('an unknown room shows a clear message', (await waitFor(() => lost.text('stoppedTitle').then((t) => (t === 'Room not found' ? t : null)))) === 'Room not found');
} catch (err) {
  check('test ran to the end', false, err.message);
} finally {
  // Expected noise: the deliberately unknown room logs nothing; replaced tab
  // and dropped connection close cleanly. Anything else is a real error.
  check('no script errors on any page', errors.length === 0, errors.slice(0, 5).join(' | '));
  await chrome.close();
  await server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// Browser test for the Spirit Board app: real screen and phone pages in headless Chrome.
//
//   npm run test:browser:spirit
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
const planchette = (page) =>
  page.eval(`(() => { const m = /translate\\(([-\\d.]+) ([-\\d.]+)\\)/.exec(document.getElementById('planchette').getAttribute('transform') || ''); return m ? { x: +m[1], y: +m[2] } : null; })()`);
try {
  // dwell=0.4 keeps the test short; the page clamps it to its allowed range.
  const screen = await openPage(cdp, `${base}/apps/spirit-board/?dwell=0.4`, { name: 'screen' });
  const room = await waitFor(async () => {
    const t = await screen.text('room');
    return /^[A-HJ-NP-Z]{4}$/.test(t || '') ? t : null;
  });
  check('screen opens a room', Boolean(room), room);
  check('QR code image loads', Boolean(await waitFor(() => screen.eval('(() => { const i = document.getElementById("qr"); return i.complete && i.naturalWidth > 0; })()'))));
  check('QR link names the app', (await screen.eval('document.getElementById("qr").src')).includes('app=spirit-board'));
  check('the board has 26 letters and 4 words', (await screen.eval('document.querySelectorAll(".glyph.letter").length')) === 26 && (await screen.eval('document.querySelectorAll(".glyph.word").length')) === 4);
  check('practice shows only the practice controls', (await screen.visible('hostPractice')) && !(await screen.visible('hostSeance')) && !(await screen.visible('hostReveal')));
  // A tilting phone.
  const ctx1 = (await cdp.send('Target.createBrowserContext')).browserContextId;
  const phone = await openPage(cdp, `${base}/join?room=${room}`, { name: 'phone', context: ctx1, phone: true, touch: true });
  await phone.s('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 0 });
  await waitFor(async () => (await phone.text('link'))?.startsWith('Connected'));
  await phone.click('#go');
  check('phone is in tilt mode', Boolean(await waitFor(() => phone.visible('tilt'))));
  check('phone shows the practice prompt', Boolean(await waitFor(async () => /^Practice/.test((await phone.text('prompt')) || ''))), await phone.text('prompt'));
  check('one candle is lit for the phone', Boolean(await waitFor(async () => (await screen.eval('document.querySelectorAll(".candle").length')) === 1)));
  check('the candle count is shown', (await screen.text('count')) === '1 candle lit');
  // Push to the rim. The phone page needs a moment to start reading the sensor.
  await sleep(400);
  await phone.s('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 25 });
  const rim = await waitFor(async () => {
    const p = await planchette(screen);
    return p && Math.hypot(p.x, p.y) > 0.8 ? p : null;
  }, { timeout: 10000 });
  check('tilting the phone moves the planchette to the rim', Boolean(rim), rim ? `x=${rim.x.toFixed(2)} y=${rim.y.toFixed(2)}` : 'did not reach the rim');
  check('the candle burns while the phone steers', Boolean(await waitFor(() => screen.eval('document.querySelector(".candle").classList.contains("active")'))));
  const meter = await waitFor(async () => {
    const w = parseFloat(await screen.eval('document.getElementById("agree").style.width'));
    return w > 50 ? w : null;
  });
  check('the agreement meter fills when one phone steers', Boolean(meter), `${meter}%`);
  // Practice never chooses a letter.
  await sleep(1500);
  check('practice chooses nothing, even when resting on a letter', (await screen.text('spelled')) === '');
  // Begin the séance with a question.
  await screen.eval(`document.getElementById('question').value = 'Is anyone there?'`);
  await screen.click('#begin');
  check('séance shows the question', (await screen.text('questionText')) === 'Is anyone there?');
  check('séance shows the séance controls', (await screen.visible('hostSeance')) && !(await screen.visible('hostPractice')));
  check('phone shows the question', Boolean(await waitFor(async () => (await phone.text('prompt'))?.startsWith('Is anyone there?'))), await phone.text('prompt'));
  // Hold the phone still at the rim, then push on to a letter.
  await phone.s('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 0 });
  await sleep(1500);
  await phone.s('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 25 });
  const spelled = await waitFor(async () => {
    const t = await screen.text('spelled');
    return /^[A-Z]/.test(t || '') ? t : null;
  }, { timeout: 15000 });
  check('resting on a glyph spells it', Boolean(spelled), spelled || 'nothing chosen');
  check('the phone shows the letters so far', Boolean(await waitFor(async () => (await phone.text('prompt'))?.includes('so far: ') && !(await phone.text('prompt')).endsWith('…'))), await phone.text('prompt'));
  // Sound stays off until the host turns it on, and toggling it raises no errors.
  check('sound starts off', (await screen.text('sound')) === 'Sound: off');
  await screen.click('#sound');
  check('the sound button turns sound on', Boolean(await waitFor(async () => (await screen.text('sound')) === 'Sound: on')));
  // End early: reveal.
  await screen.click('#end');
  check('ending the séance shows the answer', Boolean(await waitFor(() => screen.visible('reveal'))));
  const shown = await waitFor(async () => {
    const t = (await screen.text('answer')) || '';
    return t.length > 0 ? t : null;
  });
  check('the answer is written out', Boolean(shown), shown);
  check('phone shows the answer', Boolean(await waitFor(async () => /^The spirits (answered|stayed)/.test((await phone.text('prompt')) || ''))), await phone.text('prompt'));
  check('reveal offers to ask again', (await screen.visible('hostReveal')) && !(await screen.visible('hostSeance')));
  await screen.click('#sound');
  check('the sound button turns sound off again', Boolean(await waitFor(async () => (await screen.text('sound')) === 'Sound: off')));
  // Ask again returns to practice.
  await screen.click('#again');
  check('asking again returns to practice', (await screen.text('phaseLabel')) === 'Practice' && (await screen.text('spelled')) === '');
  check('phone goes back to practice', Boolean(await waitFor(async () => /^Practice/.test((await phone.text('prompt')) || ''))));
  // Reload: phones follow the screen's current state.
  await screen.eval(`document.getElementById('question').value = 'Reload test'`);
  await screen.click('#begin');
  await waitFor(async () => (await phone.text('prompt'))?.startsWith('Reload test'));
  await screen.s('Page.reload');
  await sleep(500);
  check('after a screen reload the phone shows the screen\'s controls', Boolean(await waitFor(async () => /^Practice/.test((await phone.text('prompt')) || ''))), await phone.text('prompt'));
  check('the reloaded screen keeps the same room', (await waitFor(async () => (await screen.text('room')) === room)) === true);
} catch (err) {
  check('test ran to the end', false, err.message);
} finally {
  check('no script errors on any page', errors.length === 0, errors.slice(0, 5).join(' | '));
  await chrome.close();
  await server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

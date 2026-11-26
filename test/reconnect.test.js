// Model-based property test over real sockets: any sequence of phones opening
// tabs, losing the network, reconnecting and sending input must leave every
// online phone with exactly one vote, equal to the last thing it sent.
//
// Tabs number their inputs from the time they were opened, like the real
// phone page (seq starts at Date.now()). An older tab therefore has lower
// sequence numbers than a newer one.
//
// Uses fast-check commands, so only steps that are valid in the current state
// run, and a failure shrinks to the shortest sequence that breaks the rule.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import WebSocket from 'ws';
import { createServer } from '../kit/server/index.js';
import { createScreenState } from '../kit/shared/screen-state.js';

let server;
let url;

before(async () => {
  server = createServer({ port: 0, host: '127.0.0.1', heartbeatMs: 60_000, log: () => {} });
  url = `ws://127.0.0.1:${await server.listen()}/ws`;
});
after(() => server.close());

// A socket wrapper with "wait for a message" and ping-based settling.
function sock() {
  const ws = new WebSocket(url);
  const waiters = [];
  const handlers = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    for (const h of handlers) h(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) waiters.splice(i, 1)[0].resolve(msg);
    }
  });
  const s = {
    ws,
    opened: new Promise((r, j) => {
      ws.once('open', r);
      ws.once('error', j);
    }),
    closed: new Promise((r) => ws.once('close', (code) => r(code))),
    onMessage: (h) => handlers.push(h),
    send: (o) => ws.send(JSON.stringify(o)),
    wait(match, ms = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), ms);
        waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      });
    },
    // Resolves once the server has processed everything sent before it.
    async settle() {
      const c = Math.random();
      const p = s.wait((m) => m.t === 'pong' && m.c === c);
      s.send({ t: 'ping', c });
      await p;
    },
  };
  return s;
}

// ---------- the system under test, driven like real phones ----------

async function connectTab(real, tab) {
  tab.s = sock();
  await tab.s.opened;
  const prev = real.current.get(tab.player);
  const reply = tab.s.wait((m) => m.t === 'welcome' || m.t === 'error');
  tab.s.send({ t: 'hello', role: 'phone', room: real.code, playerId: `player${tab.player}`, device: 'sim' });
  assert.equal((await reply).t, 'welcome');
  if (prev && prev !== tab) {
    assert.equal(await prev.s.closed, 4001); // the server replaces the older connection
    prev.state = 'replaced';
  }
  tab.state = 'connected';
  real.current.set(tab.player, tab);
  await real.screen.settle();
}

function checkInvariant(real) {
  const values = [...real.expected.values()];
  const got = real.room.agg.tilt(performance.now());
  assert.equal(got.n, values.length, `phones counted ${got.n}, expected ${values.length}`);
  if (values.length) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(Math.abs(got.x - mean) < 1e-9, `crowd x is ${got.x}, expected ${mean}`);
  }
}

// ---------- commands ----------

// The model tracks each tab's state; check() decides whether a step is valid.
class OpenTab {
  constructor(player) {
    this.player = player;
  }
  check(m) {
    return m.tabs.length < 5;
  }
  async run(m, real) {
    const tab = { player: this.player, seq: (real.tabs.length + 1) * 1_000_000, state: 'new' };
    real.tabs.push(tab);
    m.tabs.push(this.player);
    await connectTab(real, tab);
    checkInvariant(real);
  }
  toString() {
    return `open tab for phone ${this.player}`;
  }
}

class DropTab {
  constructor(t) {
    this.t = t;
  }
  check(m) {
    return this.t < m.tabs.length;
  }
  async run(m, real) {
    const tab = real.tabs[this.t];
    if (tab.state !== 'connected') return;
    const left = real.screen.wait((msg) => msg.t === 'left' && msg.id === `player${tab.player}`);
    tab.s.ws.terminate();
    await tab.s.closed;
    tab.state = 'dropped';
    real.current.delete(tab.player);
    await left;
    real.expected.delete(tab.player);
    checkInvariant(real);
  }
  toString() {
    return `tab ${this.t} loses network`;
  }
}

class ResumeTab {
  constructor(t) {
    this.t = t;
  }
  check(m) {
    return this.t < m.tabs.length;
  }
  async run(m, real) {
    const tab = real.tabs[this.t];
    if (tab.state !== 'dropped') return;
    await connectTab(real, tab);
    checkInvariant(real);
  }
  toString() {
    return `tab ${this.t} reconnects`;
  }
}

class SendTilt {
  constructor(t, x) {
    this.t = t;
    this.x = x;
  }
  check(m) {
    return this.t < m.tabs.length;
  }
  async run(m, real) {
    const tab = real.tabs[this.t];
    if (tab.state !== 'connected') return;
    const x = this.x / 100;
    tab.seq += 1;
    tab.s.send({ t: 'input', kind: 'tilt', seq: tab.seq, x, y: 0 });
    await tab.s.settle();
    await real.screen.settle();
    real.expected.set(tab.player, x);
    checkInvariant(real);
  }
  toString() {
    return `tab ${this.t} tilts to ${this.x / 100}`;
  }
}

const commands = [
  fc.nat(1).map((p) => new OpenTab(p)),
  fc.nat(4).map((t) => new DropTab(t)),
  fc.nat(4).map((t) => new ResumeTab(t)),
  fc.tuple(fc.nat(4), fc.integer({ min: -100, max: 100 })).map(([t, x]) => new SendTilt(t, x)),
];

async function runCommands(cmds) {
  const screen = sock();
  const room = createScreenState({ staleMs: 600_000 });
  screen.onMessage((msg) => room.handle(msg));
  await screen.opened;
  const welcome = screen.wait((msg) => msg.t === 'welcome');
  screen.send({ t: 'hello', role: 'screen' });
  const real = { screen, room, code: (await welcome).room, tabs: [], current: new Map(), expected: new Map() };
  try {
    await fc.asyncModelRun(() => ({ model: { tabs: [] }, real }), cmds);
  } finally {
    for (const t of real.tabs) t.s?.ws.terminate();
    screen.ws.terminate();
  }
}

// The shortest failing sequence fast-check found before the epoch fix.
test('regression: an older tab that reconnects after a newer one still counts', async () => {
  await runCommands([
    new OpenTab(0),
    new DropTab(0),
    new OpenTab(0),
    new SendTilt(1, 0),
    new ResumeTab(0),
    new SendTilt(0, -1),
  ]);
});

test('PBT: tabs, drops and reconnects never cost or add a vote', { timeout: 300_000 }, async () => {
  await fc.assert(
    // size 'large' gives runs of up to ~20 steps; small sizes average 5,
    // which is too short to reach multi-tab reconnect orderings.
    fc.asyncProperty(fc.commands(commands, { maxCommands: 24, size: 'large' }), runCommands),
    // Before the fix, 200 runs found the bug about one time in three.
    // 1500 runs (about 2 seconds) make a regression very likely to show up.
    { numRuns: 1500 },
  );
});

// Integration tests: real HTTP and WebSocket connections to the room server.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer } from '../kit/server/index.js';
import { safeJoin } from '../kit/server/static.js';

let server;
let base;
let wsBase;

before(async () => {
  server = createServer({ port: 0, host: '127.0.0.1', heartbeatMs: 60_000, helloTimeoutMs: 300, log: () => {} });
  const port = await server.listen();
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  await server.close();
});

// Opens a socket and collects messages; next(t) waits for a message of type t.
function client() {
  const ws = new WebSocket(wsBase);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const i = waiters.findIndex((w) => w.t === msg.t);
    if (i > -1) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  const opened = new Promise((r) => ws.once('open', r));
  const closed = new Promise((r) => ws.once('close', (code) => r(code)));
  return {
    ws,
    opened,
    closed,
    send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    next(t, ms = 2000) {
      const i = queue.findIndex((m) => m.t === t);
      if (i > -1) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${t}`)), ms);
        waiters.push({ t, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      });
    },
    queued: () => queue.slice(),
    close: () => ws.close(),
  };
}

async function openScreen(hello = { t: 'hello', role: 'screen' }) {
  const s = client();
  await s.opened;
  s.send(hello);
  const welcome = await s.next('welcome');
  return { s, welcome };
}

async function openPhone(room, playerId, device = 'android') {
  const p = client();
  await p.opened;
  p.send({ t: 'hello', role: 'phone', room, playerId, device });
  return p;
}

test('screen gets a room code, key and join link', async () => {
  const { s, welcome } = await openScreen();
  assert.match(welcome.room, /^[A-HJ-NP-Z]{4}$/);
  assert.ok(welcome.key.length >= 16);
  assert.match(welcome.joinUrl, new RegExp(`/join\\?room=${welcome.room}$`));
  s.close();
});

test('phone joins, screen is told, inputs are relayed with the player id', async () => {
  const { s, welcome } = await openScreen();
  const p = await openPhone(welcome.room, 'phoneA', 'ios');
  const pw = await p.next('welcome');
  assert.equal(pw.screenOnline, true);
  const joined = await s.next('joined');
  assert.deepEqual(joined, { t: 'joined', id: 'phoneA', device: 'ios', replaced: false });

  p.send({ t: 'input', kind: 'tilt', seq: 1, x: 5, y: -0.5 });
  const input = await s.next('input');
  assert.deepEqual(input, { t: 'input', kind: 'tilt', seq: 1, x: 1, y: -0.5, id: 'phoneA' });

  p.close();
  const left = await s.next('left');
  assert.equal(left.id, 'phoneA');
  s.close();
});

test('screen state reaches phones, and late joiners get the last state', async () => {
  const { s, welcome } = await openScreen();
  const p1 = await openPhone(welcome.room, 'early');
  await p1.next('welcome');
  s.send({ t: 'state', data: { round: 3 } });
  assert.deepEqual((await p1.next('state')).data, { round: 3 });

  const p2 = await openPhone(welcome.room, 'late');
  await p2.next('welcome');
  assert.deepEqual((await p2.next('state')).data, { round: 3 });
  p1.close();
  p2.close();
  s.close();
});

test('a reconnecting phone replaces its old connection without a "left" event', async () => {
  const { s, welcome } = await openScreen();
  const first = await openPhone(welcome.room, 'samePlayer');
  await first.next('welcome');
  await s.next('joined');

  const second = await openPhone(welcome.room, 'samePlayer');
  await second.next('welcome');
  assert.equal(await first.closed, 4001);
  const joined = await s.next('joined');
  assert.equal(joined.replaced, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.queued().filter((m) => m.t === 'left').length, 0);
  assert.equal(server.registry.get(welcome.room).phones.size, 1);
  second.close();
  s.close();
});

test('screen can reclaim its room after a reload; wrong key gets a new room', async () => {
  const { s, welcome } = await openScreen();
  const p = await openPhone(welcome.room, 'stayer');
  await p.next('welcome');
  s.close();
  assert.deepEqual(await p.next('screen'), { t: 'screen', online: false });

  const { s: s2, welcome: w2 } = await openScreen({ t: 'hello', role: 'screen', room: welcome.room, key: welcome.key });
  assert.equal(w2.room, welcome.room);
  assert.equal(w2.reclaimed, true);
  assert.deepEqual(w2.phones, [{ id: 'stayer', device: 'android' }]);
  assert.deepEqual(await p.next('screen'), { t: 'screen', online: true });

  const { s: s3, welcome: w3 } = await openScreen({ t: 'hello', role: 'screen', room: welcome.room, key: 'wrong-key-wrong-key' });
  assert.notEqual(w3.room, welcome.room);
  assert.equal(w3.reclaimed, false);
  p.close();
  s2.close();
  s3.close();
});

test('phone joining a missing room is refused with 4004', async () => {
  const p = await openPhone('ZZZZ', 'lost');
  assert.equal((await p.next('error')).error, 'no_room');
  assert.equal(await p.closed, 4004);
});

test('roles are enforced: phones cannot send state, screens cannot send input', async () => {
  const { s, welcome } = await openScreen();
  const p = await openPhone(welcome.room, 'roleTest');
  await p.next('welcome');
  p.send({ t: 'state', data: { hacked: true } });
  assert.equal((await p.next('error')).error, 'not_allowed');
  s.send({ t: 'input', kind: 'tap', seq: 1 });
  assert.equal((await s.next('error')).error, 'not_allowed');
  p.close();
  s.close();
});

test('bad messages get errors and do not crash the server', async () => {
  const c = client();
  await c.opened;
  c.send('not json');
  assert.equal((await c.next('error')).error, 'bad_json');
  c.send({ t: 'input', kind: 'tilt', seq: 1, x: 0, y: 0 });
  assert.equal((await c.next('error')).error, 'hello_first');
  c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
  assert.equal((await c.next('error')).error, 'binary_not_allowed');
  c.close();
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
});

test('oversized messages close the socket', async () => {
  const c = client();
  await c.opened;
  c.send('x'.repeat(5000));
  assert.equal(await c.closed, 1009);
});

test('connections that never say hello are closed', async () => {
  const c = client();
  await c.opened;
  assert.equal(await c.closed, 4000);
});

test('message floods are rate limited', async () => {
  const { s, welcome } = await openScreen();
  const p = await openPhone(welcome.room, 'flooder');
  await p.next('welcome');
  await s.next('joined');
  let received = 0;
  s.ws.on('message', (d) => {
    if (JSON.parse(d.toString()).t === 'input') received++;
  });
  for (let i = 1; i <= 400; i++) p.send({ t: 'input', kind: 'tap', seq: i });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(received < 200, `expected rate limiting, got ${received}`);
  p.close();
  s.close();
});

test('HTTP: pages, QR code and path safety', async () => {
  const demo = await fetch(`${base}/demo/`);
  assert.equal(demo.status, 200);
  assert.match(await demo.text(), /Feasibility test/);

  const join = await fetch(`${base}/join?room=ABCD`);
  assert.equal(join.status, 200);

  const sdk = await fetch(`${base}/kit/client/phone-sdk.js`);
  assert.equal(sdk.headers.get('content-type'), 'text/javascript; charset=utf-8');

  const qr = await fetch(`${base}/qr?room=ABCD`);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /<svg/);
  assert.equal((await fetch(`${base}/qr?room=<x>`)).status, 400);

  // The server's own code is not served.
  assert.equal((await fetch(`${base}/kit/server/index.js`)).status, 404);
  assert.notEqual((await fetch(`${base}/kit/client/..%2f..%2fpackage.json`)).status, 200);
});

test('safeJoin never escapes its root', () => {
  const root = '/srv/site';
  assert.equal(safeJoin(root, '../etc/passwd'), null);
  assert.equal(safeJoin(root, '..%2f..%2fetc%2fpasswd'), null);
  assert.equal(safeJoin(root, '%2e%2e/secret'), null);
  assert.equal(safeJoin(root, 'a\0b'), null);
  assert.equal(safeJoin(root, 'ok/file.js'), '/srv/site/ok/file.js');
});

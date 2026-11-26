// Load test: 50 phones stream tilt to one screen through the real server.
// Checks that every phone is counted once and the crowd mean is correct.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer } from '../kit/server/index.js';
import { createAggregator } from '../kit/shared/aggregate.js';

const PHONES = 50;

test(`${PHONES} phones: all relayed, one vote each, correct mean`, async () => {
  const server = createServer({ port: 0, host: '127.0.0.1', heartbeatMs: 60_000, log: () => {} });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}/ws`;

  const agg = createAggregator({ staleMs: 60_000 });
  const screen = new WebSocket(url);
  const room = await new Promise((resolve) => {
    screen.on('open', () => screen.send(JSON.stringify({ t: 'hello', role: 'screen' })));
    screen.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.t === 'welcome') resolve(msg.room);
      if (msg.t === 'input') agg.accept(msg.id, msg, 0);
    });
  });

  // Phone i tilts to x = i/PHONES*2-1 (spread across the range), y = 0.5.
  const phones = await Promise.all(
    Array.from({ length: PHONES }, (_, i) =>
      new Promise((resolve) => {
        const ws = new WebSocket(url);
        ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', role: 'phone', room, playerId: `load${i}`, device: 'sim' })));
        ws.on('message', (d) => {
          if (JSON.parse(d.toString()).t === 'welcome') resolve({ ws, i });
        });
      }),
    ),
  );

  // Each phone sends 20 readings; only the last one should count.
  for (let step = 1; step <= 20; step++) {
    for (const { ws, i } of phones) {
      const x = step === 20 ? (i / PHONES) * 2 - 1 : Math.random() * 2 - 1;
      ws.send(JSON.stringify({ t: 'input', kind: 'tilt', seq: step, x, y: step === 20 ? 0.5 : -1 }));
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 300));

  const result = agg.tilt(0);
  const wantX = Array.from({ length: PHONES }, (_, i) => (i / PHONES) * 2 - 1).reduce((a, b) => a + b) / PHONES;
  assert.equal(result.n, PHONES);
  assert.ok(Math.abs(result.x - wantX) < 1e-9, `x ${result.x} vs ${wantX}`);
  assert.ok(Math.abs(result.y - 0.5) < 1e-9);

  for (const { ws } of phones) ws.close();
  screen.close();
  await server.close();
});

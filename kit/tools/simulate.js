// Crowd simulator: connects N fake phones to a room and streams tilt.
//
//   npm run sim -- --room ABCD --phones 50
//   npm run sim -- --url wss://example.trycloudflare.com/ws --room ABCD --phones 50 --seconds 60
//
// Each phone wanders smoothly around a shared target, so the crowd dot moves
// visibly. Prints connection count, round-trip times and errors every second.

import WebSocket from 'ws';
import { normalizeRoomCode } from '../shared/protocol.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg('url', 'ws://localhost:8787/ws');
const room = normalizeRoomCode(arg('room', ''));
const count = Math.max(1, Math.min(500, Number(arg('phones', 20)) || 20));
const seconds = Math.max(1, Number(arg('seconds', 0)) || Infinity);
const hz = Math.max(1, Math.min(30, Number(arg('hz', 20)) || 20));

if (!room) {
  console.error('Give a room code: npm run sim -- --room ABCD [--phones 50] [--url ws://host/ws]');
  process.exit(1);
}

const stats = { open: 0, errors: 0, rtts: [] };
const phones = [];

function startPhone(i) {
  const ws = new WebSocket(url);
  const id = `sim${String(i).padStart(4, '0')}${Math.random().toString(36).slice(2, 8)}`;
  let seq = Date.now();
  let phase = Math.random() * Math.PI * 2;
  let timer = null;
  let pinger = null;

  ws.on('open', () => {
    stats.open++;
    ws.send(JSON.stringify({ t: 'hello', role: 'phone', room, playerId: id, device: 'sim' }));
    timer = setInterval(() => {
      // Shared slow circle plus personal wobble.
      const t = Date.now() / 1000;
      phase += 0.05 + Math.random() * 0.02;
      const x = 0.7 * Math.cos(t * 0.5) + 0.25 * Math.cos(phase);
      const y = 0.7 * Math.sin(t * 0.5) + 0.25 * Math.sin(phase);
      ws.send(JSON.stringify({ t: 'input', kind: 'tilt', seq: ++seq, x: clamp(x), y: clamp(y) }));
    }, 1000 / hz);
    pinger = setInterval(() => ws.send(JSON.stringify({ t: 'ping', c: performance.now() })), 2000);
  });
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.t === 'pong') {
      const rtt = performance.now() - msg.c;
      stats.rtts.push(rtt);
      ws.send(JSON.stringify({ t: 'stats', rtt: Math.round(rtt), hz }));
    } else if (msg.t === 'error') {
      stats.errors++;
      if (stats.errors < 5) console.error(`phone ${i}: ${msg.error}`);
    }
  });
  ws.on('close', (code) => {
    clearInterval(timer);
    clearInterval(pinger);
    stats.open--;
    if (code === 4004) {
      console.error(`Room ${room} not found. Open the screen first and copy its code.`);
      process.exit(1);
    }
  });
  ws.on('error', () => {
    stats.errors++;
  });
  phones.push(ws);
}

function clamp(v) {
  return Math.max(-1, Math.min(1, Math.round(v * 1000) / 1000));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// Stagger joins like a real crowd scanning a code.
for (let i = 0; i < count; i++) setTimeout(() => startPhone(i), i * 40);

const started = Date.now();
const report = setInterval(() => {
  const p50 = percentile(stats.rtts, 50);
  const p95 = percentile(stats.rtts, 95);
  console.log(
    `${Math.round((Date.now() - started) / 1000)}s  open=${stats.open}/${count}  rtt p50=${p50?.toFixed(0) ?? '-'}ms p95=${p95?.toFixed(0) ?? '-'}ms  errors=${stats.errors}`,
  );
  stats.rtts = stats.rtts.slice(-2000);
  if ((Date.now() - started) / 1000 >= seconds) stop();
}, 1000);

function stop() {
  clearInterval(report);
  for (const ws of phones) ws.close();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', stop);

// PossessionKit room server: static files, QR codes and the WebSocket relay.
//
//   npm start                 -> http://localhost:8787
//   PORT=9000 npm start       -> choose a port
//   PUBLIC_URL=https://x.example npm start  -> fixes the join link host
//
// The server validates and relays. The screen owns app state.

import { createServer as createHttpServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { ALLOWED, LIMITS, PROTOCOL_VERSION, normalizeRoomCode, parseClientMessage } from '../shared/protocol.js';
import { createRoomRegistry } from './rooms.js';
import { serveStatic } from './static.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const HOST_RE = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;

export function createServer({
  port = 8787,
  host = '0.0.0.0',
  publicUrl = process.env.PUBLIC_URL || '',
  graceMs = LIMITS.roomGraceMs,
  heartbeatMs = 15_000,
  helloTimeoutMs = LIMITS.helloTimeoutMs,
  log = (...args) => console.log(...args),
} = {}) {
  const registry = createRoomRegistry({ graceMs });
  const lastState = new Map(); // room code -> last state text sent to phones
  const appRoots = findApps();

  const http = createHttpServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      log('http error', err);
      if (!res.headersSent) res.writeHead(500).end('server error');
    });
  });

  async function handleHttp(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (path === '/') {
      res.writeHead(302, { Location: '/demo/' }).end();
      return;
    }
    if (path === '/healthz') {
      json(res, { ok: true, v: PROTOCOL_VERSION, ...registry.stats() });
      return;
    }
    if (path === '/qr') {
      const room = normalizeRoomCode(url.searchParams.get('room'));
      const app = cleanAppName(url.searchParams.get('app'));
      if (!room) {
        res.writeHead(400).end('bad room');
        return;
      }
      const svg = await QRCode.toString(joinUrl(req, room, app), {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).end(svg);
      return;
    }
    if (path === '/join' || path === '/join/') {
      if (await serveStatic(req, res, join(REPO, 'kit', 'client'), 'phone.html')) return;
    }
    if (path.startsWith('/kit/client/') || path.startsWith('/kit/shared/')) {
      if (await serveStatic(req, res, join(REPO, 'kit'), path.slice('/kit/'.length))) return;
    }
    if (path === '/demo') {
      res.writeHead(302, { Location: '/demo/' }).end();
      return;
    }
    if (path.startsWith('/demo/')) {
      if (await serveStatic(req, res, join(REPO, 'kit', 'demo'), path.slice('/demo/'.length))) return;
    }
    const appMatch = path.match(/^\/apps\/([a-z0-9-]+)(\/.*)?$/);
    if (appMatch && appRoots.has(appMatch[1])) {
      if (!appMatch[2]) {
        res.writeHead(302, { Location: `/apps/${appMatch[1]}/` }).end();
        return;
      }
      if (await serveStatic(req, res, appRoots.get(appMatch[1]), appMatch[2].slice(1))) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }

  function baseUrl(req) {
    if (publicUrl) return publicUrl.replace(/\/+$/, '');
    const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const proto = fwd === 'https' || fwd === 'http' ? fwd : req.socket.encrypted ? 'https' : 'http';
    const hostHeader = String(req.headers.host || '');
    const safeHost = HOST_RE.test(hostHeader) ? hostHeader : `localhost:${actualPort()}`;
    return `${proto}://${safeHost}`;
  }

  function joinUrl(req, room, app) {
    const params = new URLSearchParams({ room });
    if (app) params.set('app', app);
    return `${baseUrl(req)}/join?${params}`;
  }

  // ---------- WebSocket relay ----------

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxMessageBytes });

  http.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://local');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const conn = {
      role: null,
      room: null,
      playerId: null,
      alive: true,
      tokens: LIMITS.rateBurst,
      lastRefill: Date.now(),
      dropped: 0,
    };

    const helloTimer = setTimeout(() => {
      if (!conn.role) ws.close(4000, 'hello required');
    }, helloTimeoutMs);

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        sendError(ws, 'binary_not_allowed');
        return;
      }
      if (!takeToken(conn)) {
        conn.dropped++;
        if (conn.dropped > 600) ws.close(4008, 'rate limit');
        return;
      }
      const parsed = parseClientMessage(data.toString('utf8'));
      if (!parsed.ok) {
        sendError(ws, parsed.error);
        return;
      }
      const msg = parsed.msg;

      if (!conn.role) {
        if (msg.t !== 'hello') {
          sendError(ws, 'hello_first');
          return;
        }
        clearTimeout(helloTimer);
        if (msg.role === 'screen') onScreenHello(ws, conn, msg, req);
        else onPhoneHello(ws, conn, msg);
        return;
      }

      if (msg.t === 'hello') {
        sendError(ws, 'already_hello');
        return;
      }
      if (!ALLOWED[conn.role].includes(msg.t)) {
        sendError(ws, 'not_allowed');
        return;
      }
      if (msg.t === 'ping') {
        send(ws, { t: 'pong', c: msg.c, s: Date.now() });
        return;
      }
      const room = registry.get(conn.room);
      if (!room) return;

      if (conn.role === 'phone') {
        if (room.screen) send(room.screen, { ...msg, id: conn.playerId });
      } else if (msg.t === 'state') {
        const text = JSON.stringify({ t: 'state', data: msg.data });
        lastState.set(room.code, text);
        for (const { ws: phone } of room.phones.values()) sendRaw(phone, text);
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!conn.room) return;
      if (conn.role === 'phone') {
        if (registry.removePhone(conn.room, conn.playerId, ws)) {
          const room = registry.get(conn.room);
          if (room?.screen) send(room.screen, { t: 'left', id: conn.playerId });
        }
      } else if (conn.role === 'screen') {
        const room = registry.get(conn.room);
        if (room && room.screen === ws) {
          registry.screenLeft(conn.room, ws);
          for (const { ws: phone } of room.phones.values()) send(phone, { t: 'screen', online: false });
        }
      }
    });

    ws.on('error', () => {});
    ws.conn = conn;
  });

  function onScreenHello(ws, conn, msg, req) {
    let room = null;
    let reclaimed = false;
    if (msg.room && msg.key) {
      room = registry.reclaim(msg.room, msg.key, ws);
      reclaimed = Boolean(room);
    }
    if (!room) room = registry.createRoom(ws);
    conn.role = 'screen';
    conn.room = room.code;
    const phones = [...room.phones.entries()].map(([id, p]) => ({ id, device: p.device }));
    send(ws, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      role: 'screen',
      room: room.code,
      key: room.key,
      reclaimed,
      joinUrl: joinUrl(req, room.code, null),
      phones,
    });
    if (reclaimed) {
      for (const { ws: phone } of room.phones.values()) send(phone, { t: 'screen', online: true });
    }
  }

  function onPhoneHello(ws, conn, msg) {
    const result = registry.addPhone(msg.room, msg.playerId, ws, msg.device);
    if (result.error) {
      sendError(ws, result.error);
      ws.close(result.error === 'no_room' ? 4004 : 4005, result.error);
      return;
    }
    conn.role = 'phone';
    conn.room = msg.room;
    conn.playerId = msg.playerId;
    const room = result.room;
    send(ws, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      role: 'phone',
      room: room.code,
      playerId: msg.playerId,
      screenOnline: Boolean(room.screen),
      count: room.phones.size,
    });
    const last = lastState.get(room.code);
    if (last) sendRaw(ws, last);
    if (room.screen) {
      send(room.screen, { t: 'joined', id: msg.playerId, device: msg.device, replaced: result.replaced });
    }
  }

  // ---------- timers ----------

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const conn = ws.conn;
      if (!conn) continue;
      if (!conn.alive) {
        ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        ws.ping();
      } catch {
        // socket already closing
      }
    }
  }, heartbeatMs);

  const sweeper = setInterval(() => {
    for (const code of registry.sweep()) lastState.delete(code);
  }, Math.min(graceMs, 10_000));

  function actualPort() {
    const addr = http.address();
    return addr && typeof addr === 'object' ? addr.port : port;
  }

  function listen() {
    return new Promise((resolveListen) => {
      http.listen(port, host, () => resolveListen(actualPort()));
    });
  }

  async function close() {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((r) => wss.close(() => r()));
    await new Promise((r) => http.close(() => r()));
  }

  return { http, wss, registry, listen, close, port: actualPort };
}

function takeToken(conn) {
  const now = Date.now();
  const rate = conn.role === 'screen' ? LIMITS.screenRatePerSecond : LIMITS.ratePerSecond;
  conn.tokens = Math.min(LIMITS.rateBurst, conn.tokens + ((now - conn.lastRefill) / 1000) * rate);
  conn.lastRefill = now;
  if (conn.tokens < 1) return false;
  conn.tokens -= 1;
  return true;
}

function send(ws, obj) {
  sendRaw(ws, JSON.stringify(obj));
}

function sendRaw(ws, text) {
  if (ws.readyState === 1) ws.send(text);
}

function sendError(ws, error) {
  send(ws, { t: 'error', error });
}

function json(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
}

function cleanAppName(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) ? value : null;
}

// Each app with a public/ folder is served at /apps/<name>/.
function findApps() {
  const roots = new Map();
  const appsDir = join(REPO, 'apps');
  let names = [];
  try {
    names = readdirSync(appsDir);
  } catch {
    return roots;
  }
  for (const name of names) {
    const pub = join(appsDir, name, 'public');
    try {
      if (/^[a-z0-9-]+$/.test(name) && statSync(pub).isDirectory()) roots.set(name, pub);
    } catch {
      // no public folder yet
    }
  }
  return roots;
}

// Run directly: start the server.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT) || 8787;
  const server = createServer({ port });
  server.listen().then((p) => {
    console.log(`PossessionKit server on http://localhost:${p}`);
    console.log(`Feasibility screen:  http://localhost:${p}/demo/`);
    console.log('Phones need HTTPS for tilt. In another terminal run:');
    console.log(`  cloudflared tunnel --url http://localhost:${p}`);
  });
  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

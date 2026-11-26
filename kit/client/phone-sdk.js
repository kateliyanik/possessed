// Phone side of PossessionKit: joins a room and streams inputs to the screen.

import { connect, wsUrl } from './socket.js';
import { normalizeRoomCode } from '../shared/protocol.js';

const SEND_HZ = 20;
const KEEPALIVE_MS = 400; // resend unchanged tilt so it never goes stale
const STATS_MS = 2000;

export function detectDevice() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (navigator.maxTouchPoints > 0) return 'other';
  return 'desktop';
}

function playerId() {
  const KEY = 'possessed.playerId';
  let id = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    // private mode: fall back to a per-page id
  }
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = 'p' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // ignore
    }
  }
  return id;
}

// Returns null if the room code is invalid.
export function createPhone({ room, onState = () => {}, onStatus = () => {}, onScreen = () => {} }) {
  const code = normalizeRoomCode(room);
  if (!code) return null;

  const id = playerId();
  const device = detectDevice();
  // Start from the clock so sequence numbers keep increasing across reloads.
  let seq = Date.now();
  let rtt = null;
  let sentThisWindow = 0;
  let hz = 0;
  let pending = null;
  let lastSent = null;
  let lastSentAt = 0;
  let rejoins = -1;

  const socket = connect({
    url: wsUrl(),
    hello: () => ({ t: 'hello', role: 'phone', room: code, playerId: id, device }),
    onMessage(msg) {
      if (msg.t === 'state') onState(msg.data);
      else if (msg.t === 'pong' && Number.isFinite(msg.c)) rtt = performance.now() - msg.c;
      else if (msg.t === 'screen') onScreen(Boolean(msg.online));
      else if (msg.t === 'welcome') onScreen(Boolean(msg.screenOnline));
      else if (msg.t === 'error') onStatus({ state: 'error', reason: msg.error });
    },
    onStatus(s) {
      if (s.state === 'open') rejoins++;
      onStatus({ ...s, rejoins: Math.max(0, rejoins) });
    },
  });

  function next() {
    seq += 1;
    return seq;
  }

  // Tilt is coalesced to SEND_HZ; only the newest value is sent.
  function tilt(x, y) {
    pending = { x, y };
  }

  const sendTimer = setInterval(() => {
    const now = performance.now();
    const value = pending || lastSent;
    if (!value) return;
    const changed = pending && (!lastSent || pending.x !== lastSent.x || pending.y !== lastSent.y);
    if (!changed && now - lastSentAt < KEEPALIVE_MS) return;
    if (socket.send({ t: 'input', kind: 'tilt', seq: next(), x: round(value.x), y: round(value.y) })) {
      sentThisWindow++;
      lastSent = value;
      lastSentAt = now;
      pending = null;
    }
  }, 1000 / SEND_HZ);

  // Stop holding the last tilt (for example when a finger lifts off the pad).
  function release() {
    pending = null;
    lastSent = null;
  }

  function tap() {
    socket.send({ t: 'input', kind: 'tap', seq: next() });
  }

  function shake(v) {
    socket.send({ t: 'input', kind: 'shake', seq: next(), v: round(v) });
  }

  // Vote for option o in round r of a multiple-choice question.
  function choice(o, r) {
    return socket.send({ t: 'input', kind: 'choice', seq: next(), o, r });
  }

  const statsTimer = setInterval(() => {
    hz = (sentThisWindow * 1000) / STATS_MS;
    sentThisWindow = 0;
    socket.send({ t: 'ping', c: performance.now() });
    if (rtt !== null) socket.send({ t: 'stats', rtt: Math.round(rtt), hz: Math.round(hz * 10) / 10 });
  }, STATS_MS);

  return {
    id,
    device,
    room: code,
    tilt,
    release,
    tap,
    shake,
    choice,
    stats: () => ({ rtt, hz }),
    close() {
      clearInterval(sendTimer);
      clearInterval(statsTimer);
      socket.close();
    },
  };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

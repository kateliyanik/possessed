// PossessionKit wire protocol. Pure module: shared by the server and browsers.
// Every client message passes through parseClientMessage before it is used.

export const PROTOCOL_VERSION = 1;

export const LIMITS = Object.freeze({
  maxMessageBytes: 2048,
  maxStateBytes: 1900,
  maxIdLength: 64,
  maxDeviceLength: 40,
  maxPhonesPerRoom: 200,
  helloTimeoutMs: 10_000,
  roomGraceMs: 120_000,
  // Per connection. Tilt streams at ~20 Hz, so 60/s leaves headroom.
  ratePerSecond: 60,
  rateBurst: 90,
  // Screens broadcast state, which can be frequent but must be bounded.
  screenRatePerSecond: 40,
});

export const ROLES = Object.freeze(['screen', 'phone']);

// Which message types each role may send after hello.
export const ALLOWED = Object.freeze({
  screen: Object.freeze(['state', 'ping']),
  phone: Object.freeze(['input', 'stats', 'ping']),
});
export const INPUT_KINDS = Object.freeze(['tilt', 'tap', 'shake']);
export const DEVICES = Object.freeze(['ios', 'android', 'desktop', 'sim', 'other']);

// Room codes avoid I and O so they cannot be misread as 1 and 0.
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;
const ROOM_RE = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isRoomCode(value) {
  return typeof value === 'string' && ROOM_RE.test(value);
}

export function normalizeRoomCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return isRoomCode(code) ? code : null;
}

export function isId(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

export function clamp(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function isSeq(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function fail(error) {
  return { ok: false, error };
}

function ok(msg) {
  return { ok: true, msg };
}

// Returns { ok: true, msg } with a cleaned message, or { ok: false, error }.
// `raw` is the text received from the socket.
export function parseClientMessage(raw) {
  if (typeof raw !== 'string') return fail('not_text');
  if (byteLength(raw) > LIMITS.maxMessageBytes) return fail('too_large');

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail('bad_json');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return fail('not_object');

  switch (data.t) {
    case 'hello':
      return parseHello(data);
    case 'input':
      return parseInput(data);
    case 'state':
      return parseState(data, raw);
    case 'ping':
      if (!Number.isFinite(data.c)) return fail('bad_ping');
      return ok({ t: 'ping', c: data.c });
    case 'stats':
      // Phone-reported link quality, shown on the feasibility screen.
      if (typeof data.rtt !== 'number' || typeof data.hz !== 'number') return fail('bad_stats');
      return ok({ t: 'stats', rtt: clamp(data.rtt, 0, 10_000), hz: clamp(data.hz, 0, 200) });
    default:
      return fail('unknown_type');
  }
}

function parseHello(data) {
  if (!ROLES.includes(data.role)) return fail('bad_role');

  if (data.role === 'screen') {
    const msg = { t: 'hello', role: 'screen' };
    if (data.room !== undefined || data.key !== undefined) {
      // Reclaiming a room needs both values; otherwise a new room is made.
      if (isRoomCode(data.room) && isId(data.key)) {
        msg.room = data.room;
        msg.key = data.key;
      }
    }
    return ok(msg);
  }

  const room = normalizeRoomCode(data.room);
  if (!room) return fail('bad_room');
  if (!isId(data.playerId)) return fail('bad_player');
  const device = DEVICES.includes(data.device) ? data.device : 'other';
  return ok({ t: 'hello', role: 'phone', room, playerId: data.playerId, device });
}

function parseInput(data) {
  if (!INPUT_KINDS.includes(data.kind)) return fail('bad_kind');
  if (!isSeq(data.seq)) return fail('bad_seq');

  const msg = { t: 'input', kind: data.kind, seq: data.seq };
  if (data.kind === 'tilt') {
    if (typeof data.x !== 'number' || typeof data.y !== 'number') return fail('bad_tilt');
    msg.x = clamp(data.x, -1, 1);
    msg.y = clamp(data.y, -1, 1);
  } else if (data.kind === 'shake') {
    msg.v = clamp(data.v, 0, 1);
  }
  return ok(msg);
}

function parseState(data, raw) {
  if (byteLength(raw) > LIMITS.maxStateBytes) return fail('state_too_large');
  if (data.data === undefined) return fail('bad_state');
  return ok({ t: 'state', data: data.data });
}

// UTF-8 length without Node's Buffer, so this module also runs in browsers.
export function byteLength(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

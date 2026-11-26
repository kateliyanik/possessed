// Room registry. Keeps track of one screen and many phones per room.
// It only stores connections and relays messages; app logic lives on the screen.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { LIMITS, ROOM_ALPHABET, ROOM_CODE_LENGTH } from '../shared/protocol.js';

export function createRoomRegistry({
  graceMs = LIMITS.roomGraceMs,
  maxPhones = LIMITS.maxPhonesPerRoom,
  now = () => Date.now(),
} = {}) {
  const rooms = new Map();

  function newCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
    throw new Error('no free room codes');
  }

  function createRoom(screen) {
    const code = newCode();
    const room = {
      code,
      key: randomBytes(18).toString('base64url'),
      screen,
      phones: new Map(), // playerId -> { ws, device }
      screenGoneAt: null,
      createdAt: now(),
    };
    rooms.set(code, room);
    return room;
  }

  // Returns the room if code and key match, otherwise null.
  function reclaim(code, key, screen) {
    const room = rooms.get(code);
    if (!room || !safeEqual(room.key, key)) return null;
    if (room.screen && room.screen !== screen) {
      room.screen.close(4002, 'screen replaced');
    }
    room.screen = screen;
    room.screenGoneAt = null;
    return room;
  }

  function get(code) {
    return rooms.get(code) || null;
  }

  // Adds a phone. Returns { room, replaced } or { error }.
  function addPhone(code, playerId, ws, device) {
    const room = rooms.get(code);
    if (!room) return { error: 'no_room' };
    const existing = room.phones.get(playerId);
    if (!existing && room.phones.size >= maxPhones) return { error: 'room_full' };
    room.phones.set(playerId, { ws, device });
    if (existing && existing.ws !== ws) {
      // Same player on a new connection (reload or reconnect): keep the new one.
      existing.ws.close(4001, 'replaced by new connection');
    }
    return { room, replaced: Boolean(existing) };
  }

  // Removes the phone only if this exact connection is still the current one.
  function removePhone(code, playerId, ws) {
    const room = rooms.get(code);
    if (!room) return false;
    const current = room.phones.get(playerId);
    if (!current || current.ws !== ws) return false;
    room.phones.delete(playerId);
    return true;
  }

  function screenLeft(code, ws) {
    const room = rooms.get(code);
    if (!room || room.screen !== ws) return;
    room.screen = null;
    room.screenGoneAt = now();
  }

  // Closes rooms whose screen has been gone longer than the grace period.
  function sweep() {
    const t = now();
    const closed = [];
    for (const room of rooms.values()) {
      if (room.screen === null && room.screenGoneAt !== null && t - room.screenGoneAt > graceMs) {
        for (const { ws } of room.phones.values()) ws.close(4003, 'room closed');
        rooms.delete(room.code);
        closed.push(room.code);
      }
    }
    return closed;
  }

  function stats() {
    let phones = 0;
    for (const room of rooms.values()) phones += room.phones.size;
    return { rooms: rooms.size, phones };
  }

  return { createRoom, reclaim, get, addPhone, removePhone, screenLeft, sweep, stats };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

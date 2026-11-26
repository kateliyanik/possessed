// Crowd aggregation. Pure module: runs on the screen (and in tests).
//
// Fairness rules:
// - One phone, one vote: only each player's latest input counts.
// - A replayed or out-of-order input (seq not greater than the last one) is ignored.
// - An input older than staleMs no longer counts, so idle phones drop out.
// - The result does not depend on the order players are processed in.

import { clamp } from './protocol.js';

export const DEFAULT_STALE_MS = 1500;

export function createAggregator({ staleMs = DEFAULT_STALE_MS } = {}) {
  // playerId -> { tilt: {x, y, at}, shake: {v, at}, taps: [at...], lastSeq }
  const players = new Map();

  function entry(playerId) {
    let e = players.get(playerId);
    if (!e) {
      e = { tilt: null, shake: null, lastTapAt: -Infinity, lastSeq: -1 };
      players.set(playerId, e);
    }
    return e;
  }

  // Returns true if the input was accepted.
  function accept(playerId, input, now) {
    if (!input || !Number.isSafeInteger(input.seq)) return false;
    const e = entry(playerId);
    if (input.seq <= e.lastSeq) return false;
    e.lastSeq = input.seq;

    if (input.kind === 'tilt') {
      e.tilt = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1), at: now };
    } else if (input.kind === 'shake') {
      e.shake = { v: clamp(input.v, 0, 1), at: now };
    } else if (input.kind === 'tap') {
      e.lastTapAt = now;
    } else {
      return false;
    }
    return true;
  }

  function remove(playerId) {
    players.delete(playerId);
  }

  // Forget a player's inputs but keep their sequence number, so a replayed
  // message from before a reconnect still cannot count twice.
  function clearInputs(playerId) {
    const e = players.get(playerId);
    if (e) {
      e.tilt = null;
      e.shake = null;
      e.lastTapAt = -Infinity;
    }
  }

  function isFresh(at, now) {
    return at !== undefined && at !== null && now - at <= staleMs && now >= at;
  }

  // Mean tilt of players with a fresh tilt. Order-independent and bounded.
  function tilt(now) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    // Sort ids so floating-point summation order is fixed regardless of
    // insertion order. That makes the result exactly order-independent.
    for (const id of sortedIds()) {
      const t = players.get(id).tilt;
      if (t && isFresh(t.at, now)) {
        sx += t.x;
        sy += t.y;
        n++;
      }
    }
    if (n === 0) return { x: 0, y: 0, n: 0 };
    return { x: clamp(sx / n, -1, 1), y: clamp(sy / n, -1, 1), n };
  }

  // Each player's share of the total tilt magnitude, for the influence
  // display. Shares sum to 1 when anyone is tilting.
  function influence(now) {
    const out = [];
    let total = 0;
    for (const id of sortedIds()) {
      const t = players.get(id).tilt;
      if (t && isFresh(t.at, now)) {
        const m = Math.hypot(t.x, t.y);
        out.push({ id, m });
        total += m;
      }
    }
    return out.map(({ id, m }) => ({ id, share: total > 0 ? m / total : 1 / out.length }));
  }

  // Mean shake energy across players with a fresh shake (0..1).
  function shake(now) {
    let s = 0;
    let n = 0;
    for (const id of sortedIds()) {
      const sh = players.get(id).shake;
      if (sh && isFresh(sh.at, now)) {
        s += sh.v;
        n++;
      }
    }
    return { v: n ? clamp(s / n, 0, 1) : 0, n };
  }

  // Number of distinct players who tapped within the window.
  function taps(now, windowMs = staleMs) {
    let n = 0;
    for (const e of players.values()) {
      if (now - e.lastTapAt <= windowMs && now >= e.lastTapAt) n++;
    }
    return n;
  }

  function sortedIds() {
    return [...players.keys()].sort();
  }

  function size() {
    return players.size;
  }

  return { accept, remove, clearInputs, tilt, influence, shake, taps, size };
}

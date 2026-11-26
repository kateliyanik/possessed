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
      e = { tilt: null, shake: null, choice: null, lastTapAt: -Infinity, lastEpoch: 0, lastSeq: -1 };
      players.set(playerId, e);
    }
    return e;
  }

  // Returns true if the input was accepted.
  //
  // Inputs are ordered by connection epoch first (input.e, set by the server
  // for each new phone connection), then by seq. A newer connection always
  // wins, even if its page numbered its inputs from a lower starting point.
  // Without this, an older tab that reconnects after a newer one would have
  // all of its inputs ignored (found by test/reconnect.test.js).
  function accept(playerId, input, now) {
    if (!input || !Number.isSafeInteger(input.seq)) return false;
    const epoch = Number.isSafeInteger(input.e) && input.e >= 0 ? input.e : 0;
    const e = entry(playerId);
    if (epoch < e.lastEpoch) return false;
    if (epoch === e.lastEpoch && input.seq <= e.lastSeq) return false;
    e.lastEpoch = epoch;
    e.lastSeq = input.seq;

    if (input.kind === 'tilt') {
      e.tilt = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1), at: now };
    } else if (input.kind === 'shake') {
      e.shake = { v: clamp(input.v, 0, 1), at: now };
    } else if (input.kind === 'tap') {
      e.lastTapAt = now;
    } else if (input.kind === 'choice') {
      if (!Number.isInteger(input.o) || input.o < 0 || !Number.isInteger(input.r)) return false;
      // A vote stands until the player changes it, leaves, or a new round starts.
      e.choice = { o: input.o, r: input.r };
    } else {
      return false;
    }
    return true;
  }

  // Votes for one round of a multiple-choice question.
  // Each player counts once, with their latest choice for this round.
  // leader is the option with the most votes, or null if nobody voted or the
  // top options are tied.
  function tally(round, optionCount) {
    const counts = new Array(Math.max(0, optionCount | 0)).fill(0);
    let total = 0;
    for (const e of players.values()) {
      const c = e.choice;
      if (c && c.r === round && c.o < counts.length) {
        counts[c.o]++;
        total++;
      }
    }
    let leader = null;
    let best = 0;
    let tied = false;
    counts.forEach((n, i) => {
      if (n > best) {
        best = n;
        leader = i;
        tied = false;
      } else if (n === best && n > 0) {
        tied = true;
      }
    });
    return { counts, total, leader: tied ? null : leader };
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
      e.choice = null;
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

  // Shake across the room.
  //   v      mean energy of the players who are shaking (0..1)
  //   n      how many are shaking
  //   peak   the strongest single shake ("strongest wins")
  //   energy the room's effort: total shake divided by everyone taking part,
  //          so one wild phone cannot fill the meter for a quiet room.
  // participants is the number of phones online; defaults to the shakers.
  function shake(now, participants = 0) {
    let s = 0;
    let n = 0;
    let peak = 0;
    for (const id of sortedIds()) {
      const sh = players.get(id).shake;
      if (sh && isFresh(sh.at, now)) {
        s += sh.v;
        n++;
        if (sh.v > peak) peak = sh.v;
      }
    }
    const everyone = Math.max(n, participants | 0);
    return {
      v: n ? clamp(s / n, 0, 1) : 0,
      n,
      peak,
      energy: everyone ? clamp(s / everyone, 0, 1) : 0,
    };
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

  return { accept, remove, clearInputs, tilt, influence, shake, taps, tally, size };
}

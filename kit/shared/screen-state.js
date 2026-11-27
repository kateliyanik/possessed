// What the screen knows about its room: players, link stats and the crowd's
// aggregated input. Pure module, driven by server messages, so the browser
// screen SDK and the tests run exactly the same logic.

import { createAggregator } from './aggregate.js';

export function createScreenState({ staleMs, now = () => performance.now() } = {}) {
  const agg = createAggregator({ staleMs });
  // id -> { id, device, online, joins, rtt, hz, lastInputAt }
  const players = new Map();
  let rejoins = 0;

  function player(id, device) {
    let p = players.get(id);
    if (!p) {
      p = { id, device: device || 'other', online: false, joins: 0, rtt: null, hz: 0, lastInputAt: 0, lastJoinAt: 0 };
      players.set(id, p);
    }
    if (device) p.device = device;
    return p;
  }

  // Applies one server message. Returns what changed:
  //   'room' | 'players' | 'input' | null
  function handle(msg) {
    switch (msg && msg.t) {
      case 'welcome': {
        if (!msg.reclaimed) {
          players.clear();
          rejoins = 0;
        }
        for (const p of players.values()) p.online = false;
        for (const { id, device } of msg.phones || []) player(id, device).online = true;
        return 'room';
      }
      case 'joined': {
        const p = player(msg.id, msg.device);
        // A rejoin is a known player coming back, or the same player
        // replacing a connection that had not been closed yet.
        if (p.joins > 0 && (!p.online || msg.replaced)) rejoins++;
        p.joins++;
        p.online = true;
        p.lastJoinAt = now();
        return 'players';
      }
      case 'left': {
        const p = players.get(msg.id);
        if (p) p.online = false;
        // Their input stops counting at once, not after the stale window.
        agg.clearInputs(msg.id);
        return 'players';
      }
      case 'input': {
        const t = now();
        if (agg.accept(msg.id, msg, t)) {
          player(msg.id).lastInputAt = t;
          return 'input';
        }
        return null;
      }
      case 'stats': {
        const p = players.get(msg.id);
        if (p) {
          p.rtt = msg.rtt;
          p.hz = msg.hz;
        }
        return null;
      }
      default:
        return null;
    }
  }

  return {
    handle,
    agg,
    players: () => [...players.values()],
    online: () => [...players.values()].filter((p) => p.online),
    rejoins: () => rejoins,
  };
}

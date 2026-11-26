// Screen side of PossessionKit: owns a room, tracks phones and aggregates input.

import { connect, wsUrl } from './socket.js';
import { createAggregator } from '../shared/aggregate.js';

const STORE_KEY = 'possessed.screen';

export function createScreen({
  staleMs,
  onRoom = () => {},
  onPlayers = () => {},
  onStatus = () => {},
  onInput = () => {},
} = {}) {
  const agg = createAggregator({ staleMs });
  // id -> { id, device, online, joins, rtt, hz, lastInputAt }
  const players = new Map();
  let room = null;
  let key = null;
  let joinUrl = null;
  let rejoinCount = 0;

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved.room === 'string' && typeof saved.key === 'string') {
      room = saved.room;
      key = saved.key;
    }
  } catch {
    // ignore bad storage
  }

  function player(id, device) {
    let p = players.get(id);
    if (!p) {
      p = { id, device: device || 'other', online: false, joins: 0, rtt: null, hz: 0, lastInputAt: 0 };
      players.set(id, p);
    }
    if (device) p.device = device;
    return p;
  }

  function emitPlayers() {
    onPlayers([...players.values()]);
  }

  const socket = connect({
    url: wsUrl(),
    hello: () => (room && key ? { t: 'hello', role: 'screen', room, key } : { t: 'hello', role: 'screen' }),
    onMessage(msg) {
      switch (msg.t) {
        case 'welcome': {
          if (!msg.reclaimed) {
            players.clear();
            rejoinCount = 0;
          }
          room = msg.room;
          key = msg.key;
          joinUrl = msg.joinUrl;
          try {
            sessionStorage.setItem(STORE_KEY, JSON.stringify({ room, key }));
          } catch {
            // ignore
          }
          for (const p of players.values()) p.online = false;
          for (const { id, device } of msg.phones || []) player(id, device).online = true;
          onRoom({ room, joinUrl, reclaimed: Boolean(msg.reclaimed) });
          emitPlayers();
          break;
        }
        case 'joined': {
          const p = player(msg.id, msg.device);
          // A rejoin is a player we have seen before coming back, or the same
          // player replacing a dead connection.
          if (p.joins > 0 && (!p.online || msg.replaced)) rejoinCount++;
          p.joins++;
          p.online = true;
          emitPlayers();
          break;
        }
        case 'left': {
          const p = players.get(msg.id);
          if (p) p.online = false;
          // Their input stops counting at once, not after the stale window.
          agg.clearInputs(msg.id);
          emitPlayers();
          break;
        }
        case 'input': {
          const now = performance.now();
          if (agg.accept(msg.id, msg, now)) {
            player(msg.id).lastInputAt = now;
            onInput(msg);
          }
          break;
        }
        case 'stats': {
          const p = players.get(msg.id);
          if (p) {
            p.rtt = msg.rtt;
            p.hz = msg.hz;
          }
          break;
        }
        default:
          break;
      }
    },
    onStatus,
  });

  let lastBroadcast = 0;
  // Sends app state to all phones, at most ~15 times a second.
  function broadcast(data, { force = false } = {}) {
    const now = performance.now();
    if (!force && now - lastBroadcast < 66) return false;
    lastBroadcast = now;
    return socket.send({ t: 'state', data });
  }

  return {
    get room() {
      return room;
    },
    get joinUrl() {
      return joinUrl;
    },
    qrUrl: (app) => (room ? `/qr?room=${room}${app ? `&app=${encodeURIComponent(app)}` : ''}` : null),
    tilt: () => agg.tilt(performance.now()),
    influence: () => agg.influence(performance.now()),
    shake: () => agg.shake(performance.now()),
    taps: (windowMs) => agg.taps(performance.now(), windowMs),
    players: () => [...players.values()],
    rejoins: () => rejoinCount,
    broadcast,
    // Start a new room (forget the saved one).
    reset() {
      try {
        sessionStorage.removeItem(STORE_KEY);
      } catch {
        // ignore
      }
      location.reload();
    },
  };
}

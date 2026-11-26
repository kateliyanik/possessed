// Screen side of PossessionKit: owns a room, tracks phones and aggregates input.
// The room logic lives in kit/shared/screen-state.js so tests can run it too.

import { connect, wsUrl } from './socket.js';
import { createScreenState } from '../shared/screen-state.js';

const STORE_KEY = 'possessed.screen';

export function createScreen({
  staleMs,
  onRoom = () => {},
  onPlayers = () => {},
  onStatus = () => {},
  onInput = () => {},
} = {}) {
  const state = createScreenState({ staleMs });
  const agg = state.agg;
  let room = null;
  let key = null;
  let joinUrl = null;
  let lastData = null;

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved.room === 'string' && typeof saved.key === 'string') {
      room = saved.room;
      key = saved.key;
    }
  } catch {
    // ignore bad storage
  }

  const socket = connect({
    url: wsUrl(),
    hello: () => (room && key ? { t: 'hello', role: 'screen', room, key } : { t: 'hello', role: 'screen' }),
    onMessage(msg) {
      const changed = state.handle(msg);
      if (msg.t === 'welcome') {
        room = msg.room;
        key = msg.key;
        joinUrl = msg.joinUrl;
        try {
          sessionStorage.setItem(STORE_KEY, JSON.stringify({ room, key }));
        } catch {
          // ignore
        }
        // Re-send the app state after any reconnect, so phones that joined
        // while the screen was away still get the current controls.
        if (lastData !== null) socket.send({ t: 'state', data: lastData });
        onRoom({ room, joinUrl, reclaimed: Boolean(msg.reclaimed) });
        onPlayers(state.players());
      } else if (changed === 'players') {
        onPlayers(state.players());
      } else if (changed === 'input') {
        onInput(msg);
      }
    },
    onStatus,
  });

  let lastBroadcast = 0;
  // Sends app state to all phones, at most ~15 times a second unless forced.
  function broadcast(data, { force = false } = {}) {
    lastData = data;
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
    shake: (participants) => agg.shake(performance.now(), participants),
    taps: (windowMs) => agg.taps(performance.now(), windowMs),
    tally: (round, optionCount) => agg.tally(round, optionCount),
    players: () => state.players(),
    online: () => state.online(),
    rejoins: () => state.rejoins(),
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

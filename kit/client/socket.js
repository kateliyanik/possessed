// Reconnecting WebSocket used by phones and screens.

// Close codes after which reconnecting would not help.
const FINAL_CODES = new Map([
  [4001, 'replaced'], // the same player opened another tab or device
  [4002, 'replaced'], // another screen took over this room
  [4003, 'room_closed'],
  [4004, 'no_room'],
  [4005, 'room_full'],
]);

export function wsUrl(path = '/ws') {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

// options:
//   url        WebSocket URL
//   hello()    returns the hello message to send on every (re)connect
//   onMessage(msg)
//   onStatus({ state, attempt, reason })  state: connecting | open | retrying | stopped
export function connect({ url = wsUrl(), hello, onMessage, onStatus = () => {} }) {
  let ws = null;
  let attempt = 0;
  let stopped = false;
  let retryTimer = null;
  let connects = 0;

  function open() {
    if (stopped) return;
    clearTimeout(retryTimer);
    onStatus({ state: 'connecting', attempt });
    ws = new WebSocket(url);
    const thisWs = ws;

    thisWs.onopen = () => {
      attempt = 0;
      connects++;
      thisWs.send(JSON.stringify(hello()));
      onStatus({ state: 'open', attempt, connects });
    };
    thisWs.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      onMessage(msg);
    };
    thisWs.onclose = (ev) => {
      if (thisWs !== ws) return;
      if (FINAL_CODES.has(ev.code)) {
        stopped = true;
        onStatus({ state: 'stopped', reason: FINAL_CODES.get(ev.code) });
        return;
      }
      scheduleRetry();
    };
    thisWs.onerror = () => {
      // onclose follows and handles the retry
    };
  }

  function scheduleRetry() {
    if (stopped) return;
    attempt++;
    const base = Math.min(5000, 250 * 2 ** Math.min(attempt, 5));
    const delay = base / 2 + Math.random() * (base / 2);
    onStatus({ state: 'retrying', attempt, delay });
    retryTimer = setTimeout(open, delay);
  }

  // Reconnect at once when the network or the tab comes back.
  function nudge() {
    if (stopped) return;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      attempt = 0;
      open();
    }
  }
  window.addEventListener('online', nudge);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') nudge();
  });

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function close() {
    stopped = true;
    clearTimeout(retryTimer);
    if (ws) ws.close(1000, 'bye');
  }

  open();
  return {
    send,
    close,
    isOpen: () => Boolean(ws && ws.readyState === WebSocket.OPEN),
    get connects() {
      return connects;
    },
  };
}

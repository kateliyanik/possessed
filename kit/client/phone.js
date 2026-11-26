// Generic phone controller page, served at /join?room=ABCD.

import { createPhone } from './phone-sdk.js';
import { motionSupported, requestMotionPermission, startTilt } from './motion.js';
import { clamp, normalizeRoomCode } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = normalizeRoomCode(params.get('room'));

let phone = null;
let tilt = null;
let wakeLock = null;

function show(id) {
  for (const s of ['start', 'tilt', 'pad', 'stopped']) $(s).hidden = s !== id;
}

function setLink(text, kind) {
  const el = $('link');
  el.textContent = text;
  el.className = `link ${kind || ''}`;
}

function moveDot(el, x, y) {
  // Gauge radius minus dot radius, as a fraction of the element size.
  const r = el.parentElement.clientWidth / 2 - 22;
  el.style.transform = `translate(${x * r}px, ${y * r}px)`;
}

const STOP_TEXT = {
  replaced: ['Open in another tab', 'This phone joined from another tab or window. Use that one, or tap below to take over here.'],
  room_closed: ['The room has closed', 'The screen closed this room. Scan the new QR code to join again.'],
  no_room: ['Room not found', 'Check the code on the screen, or scan the QR code again.'],
  room_full: ['The room is full', 'Too many phones are connected. Try again in a moment.'],
};

function startPhone() {
  phone = createPhone({
    room,
    onStatus(s) {
      if (s.state === 'open') setLink(s.rejoins > 0 ? `Connected (rejoined ${s.rejoins}×)` : 'Connected', 'ok');
      else if (s.state === 'retrying' || s.state === 'connecting') setLink('Reconnecting…', 'bad');
      else if (s.state === 'stopped') {
        const [title, text] = STOP_TEXT[s.reason] || ['Disconnected', 'The connection ended.'];
        $('stoppedTitle').textContent = title;
        $('stoppedText').textContent = text;
        show('stopped');
        setLink('Not connected', 'bad');
      } else if (s.state === 'error' && s.reason) {
        setLink(`Problem: ${s.reason}`, 'bad');
      }
    },
    onScreen(online) {
      $('screenState').textContent = online ? 'Screen: live' : 'Screen: away';
    },
  });
  setInterval(() => {
    const { rtt } = phone.stats();
    $('net').textContent = rtt === null ? '-- ms' : `${Math.round(rtt)} ms`;
  }, 1000);
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // not supported or refused; the page still works
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock !== null) keepAwake();
});

async function useTilt() {
  const permission = await requestMotionPermission();
  if (permission !== 'granted') {
    usePad(permission === 'denied' ? 'Motion access was refused, so use touch.' : 'Tilt needs a secure (https) link. Use touch for now.');
    return;
  }
  show('tilt');
  tilt?.stop();
  let calibrated = false;
  tilt = startTilt({
    onTilt({ x, y }) {
      if (!calibrated) {
        // Treat the first position as level so nobody starts off-centre.
        calibrated = true;
        tilt.calibrate();
        return;
      }
      moveDot($('dot'), x, y);
      phone.tilt(x, y);
    },
    onNoData() {
      usePad('This browser sends no motion data. Use touch instead.');
    },
  });
}

function usePad(message) {
  tilt?.stop();
  tilt = null;
  phone.release();
  if (message) $('padHint').textContent = message;
  show('pad');
}

// ---------- touch pad ----------

const pad = $('padArea');
let activePointer = null;
function padPoint(ev) {
  const r = pad.getBoundingClientRect();
  let x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  let y = ((ev.clientY - r.top) / r.height) * 2 - 1;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}
pad.addEventListener('pointerdown', (ev) => {
  activePointer = ev.pointerId;
  pad.setPointerCapture(ev.pointerId);
  const { x, y } = padPoint(ev);
  moveDot($('padDot'), x, y);
  phone.tilt(x, y);
});
pad.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== activePointer) return;
  const { x, y } = padPoint(ev);
  moveDot($('padDot'), x, y);
  phone.tilt(x, y);
});
function padUp(ev) {
  if (ev.pointerId !== activePointer) return;
  activePointer = null;
  moveDot($('padDot'), 0, 0);
  // Send one centred reading, then stop holding a value.
  phone.tilt(0, 0);
  setTimeout(() => phone.release(), 200);
}
pad.addEventListener('pointerup', padUp);
pad.addEventListener('pointercancel', padUp);

// ---------- buttons ----------

$('go').addEventListener('click', async () => {
  keepAwake();
  if (motionSupported() && window.isSecureContext && navigator.maxTouchPoints > 0) await useTilt();
  else usePad(window.isSecureContext ? 'Drag inside the circle. Lift your finger to rest.' : 'Tilt needs a secure (https) link. Use touch for now.');
});
$('calibrate').addEventListener('click', () => tilt?.calibrate());
$('to-pad').addEventListener('click', () => usePad());
$('to-tilt').addEventListener('click', () => useTilt());
$('retry').addEventListener('click', () => location.reload());

// ---------- start ----------

if (!room) {
  $('stoppedTitle').textContent = 'No room code';
  $('stoppedText').textContent = 'Scan the QR code on the screen to join.';
  show('stopped');
  setLink('Not connected', 'bad');
} else {
  $('room').textContent = room;
  startPhone();
}

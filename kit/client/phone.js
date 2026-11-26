// Generic phone controller page, served at /join?room=ABCD.
//
// The screen decides which controls to show by putting a `ui` object in its
// state (see kit/shared/ui.js). Phones that join late get the latest state
// from the server, so they show the same controls as everyone else.
//
// Every motion control has a touch alternative:
//   tilt  -> drag on the touch pad
//   shake -> tap the button fast

import { createPhone } from './phone-sdk.js';
import { motionSupported, requestMotionPermission, startShake, startTilt } from './motion.js';
import { clamp, normalizeRoomCode } from '../shared/protocol.js';
import { DEFAULT_UI, parseUi } from '../shared/ui.js';

const $ = (id) => document.getElementById(id);
const room = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
const PREF_KEY = 'possessed.method';
const SECTIONS = ['start', 'tilt', 'pad', 'choice', 'tap', 'shake', 'wait', 'stopped'];

let phone = null;
let ui = { ...DEFAULT_UI };
let method = null; // 'motion' or 'touch'
let started = false;
let stopped = false;
let permission = { tilt: 'unsupported', shake: 'unsupported' };
let tiltSensor = null;
let shakeSensor = null;
let myVote = { round: -1, o: -1 };
let wakeLock = null;

// ---------- helpers ----------

function show(id) {
  for (const s of SECTIONS) $(s).hidden = s !== id;
}

function setLink(text, kind) {
  const el = $('link');
  el.textContent = text;
  el.className = `link ${kind || ''}`;
}

function buzz(ms) {
  // Browsers only allow vibration after a real tap on the page.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}

function moveDot(el, x, y) {
  const r = el.parentElement.clientWidth / 2 - 22;
  el.style.transform = `translate(${x * r}px, ${y * r}px)`;
}

function canTilt() {
  return motionSupported() && window.isSecureContext && navigator.maxTouchPoints > 0;
}

function savePref() {
  try {
    localStorage.setItem(PREF_KEY, method);
  } catch {
    // private mode
  }
}

function loadPref() {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
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

// ---------- sensors ----------

function ensureTilt() {
  if (tiltSensor) return;
  let calibrated = false;
  tiltSensor = startTilt({
    onTilt({ x, y }) {
      if (!calibrated) {
        // Treat the first position as level so nobody starts off-centre.
        calibrated = true;
        tiltSensor.calibrate();
        return;
      }
      moveDot($('dot'), x, y);
      phone.tilt(x, y);
    },
    onNoData() {
      useTouch('This browser sends no motion data, so touch controls are on.');
    },
  });
}

function stopTilt() {
  tiltSensor?.stop();
  tiltSensor = null;
}

function ensureShake() {
  if (shakeSensor) return;
  shakeSensor = startShake({
    onShake(v) {
      sensorShake = v;
      phone.shake(v);
    },
  });
}

function stopShake() {
  shakeSensor?.stop();
  shakeSensor = null;
  sensorShake = 0;
}

function useTouch(message) {
  method = 'touch';
  savePref();
  if (message) {
    $('padHint').textContent = message;
    $('shakeHint').textContent = message;
  }
  render();
}

// ---------- rendering ----------

function render() {
  if (stopped) return;
  const prompt = $('prompt');
  prompt.textContent = ui.prompt;
  prompt.hidden = !started || !ui.prompt;

  if (!started) {
    show('start');
    return;
  }
  // Leaving tilt mode: stop holding a tilt value so it drops out on the screen.
  if (ui.mode !== 'tilt') phone.release();

  switch (ui.mode) {
    case 'tilt':
      stopShake();
      if (method === 'motion') {
        ensureTilt();
        show('tilt');
      } else {
        stopTilt();
        $('toTilt').hidden = !canTilt();
        show('pad');
      }
      break;
    case 'choice':
      stopTilt();
      stopShake();
      renderOptions();
      show('choice');
      break;
    case 'tap':
      stopTilt();
      stopShake();
      show('tap');
      break;
    case 'shake':
      stopTilt();
      if (method === 'motion' && permission.shake === 'granted') ensureShake();
      else stopShake();
      show('shake');
      break;
    default:
      stopTilt();
      stopShake();
      show('wait');
  }
}

function renderOptions() {
  const box = $('options');
  const buttons = ui.options.map((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'option';
    b.textContent = label; // text from the screen is never parsed as HTML
    b.setAttribute('aria-pressed', String(myVote.round === ui.round && myVote.o === i));
    b.addEventListener('click', () => vote(i));
    return b;
  });
  box.replaceChildren(...buttons);
}

function vote(i) {
  if (phone.choice(i, ui.round)) {
    myVote = { round: ui.round, o: i };
    $('choiceHint').textContent = 'Answer sent. You can change it.';
    buzz(15);
  } else {
    $('choiceHint').textContent = 'Not sent: reconnecting. Tap again in a moment.';
  }
  renderOptions();
}

// ---------- touch pad (tilt alternative) ----------

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
  pad.setPointerCapture?.(ev.pointerId);
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
  phone.tilt(0, 0);
  setTimeout(() => phone.release(), 200);
}
pad.addEventListener('pointerup', padUp);
pad.addEventListener('pointercancel', padUp);

// ---------- tap ----------

function pulse(el) {
  el.classList.remove('pulse');
  void el.offsetWidth; // restart the animation
  el.classList.add('pulse');
}

function onTap() {
  phone.tap();
  pulse($('tapBtn'));
  buzz(10);
}
// pointerdown reacts at once; click covers keyboards and switch access.
$('tapBtn').addEventListener('pointerdown', onTap);
$('tapBtn').addEventListener('click', (ev) => {
  if (ev.detail === 0) onTap();
});

// ---------- shake (and tapping fast as its touch alternative) ----------

let touchShake = 0;
let sensorShake = 0;
let wasShaking = false;

function onShakeTap() {
  touchShake = Math.min(1, touchShake + 0.22);
  pulse($('shakeBtn'));
  buzz(5);
}
$('shakeBtn').addEventListener('pointerdown', onShakeTap);
$('shakeBtn').addEventListener('click', (ev) => {
  if (ev.detail === 0) onShakeTap();
});

setInterval(() => {
  if (!phone || ui.mode !== 'shake') {
    touchShake = 0;
    return;
  }
  if (touchShake > 0.02) {
    phone.shake(touchShake);
    wasShaking = true;
  } else if (wasShaking && !shakeSensor) {
    phone.shake(0);
    wasShaking = false;
  }
  $('shakeLevel').style.width = `${Math.round(Math.max(touchShake, sensorShake) * 100)}%`;
  touchShake *= 0.8;
  if (touchShake < 0.02) touchShake = 0;
}, 100);

// ---------- connection ----------

const STOP_TEXT = {
  replaced: ['Open in another tab', 'This phone joined from another tab or window. Use that one, or tap below to take over here.'],
  room_closed: ['The room has closed', 'The screen closed this room. Scan the new QR code to join again.'],
  no_room: ['Room not found', 'Check the code on the screen, or scan the QR code again.'],
  room_full: ['The room is full', 'Too many phones are connected. Try again in a moment.'],
};

function startPhone() {
  phone = createPhone({
    room,
    onState(data) {
      const next = data && typeof data === 'object' ? parseUi(data.ui) : null;
      if (!next) return;
      ui = next;
      render();
    },
    onStatus(s) {
      if (s.state === 'open') setLink(s.rejoins > 0 ? `Connected (rejoined ${s.rejoins}×)` : 'Connected', 'ok');
      else if (s.state === 'retrying' || s.state === 'connecting') setLink('Reconnecting…', 'bad');
      else if (s.state === 'stopped') {
        const [title, text] = STOP_TEXT[s.reason] || ['Disconnected', 'The connection ended.'];
        stopped = true;
        stopTilt();
        stopShake();
        $('prompt').hidden = true;
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

// ---------- buttons ----------

$('go').addEventListener('click', async () => {
  keepAwake();
  if (canTilt()) {
    permission = await requestMotionPermission();
    if (permission.tilt === 'granted') {
      method = 'motion';
      savePref();
      started = true;
      render();
      return;
    }
  }
  started = true;
  useTouch(
    !window.isSecureContext
      ? 'Tilt needs a secure (https) link, so touch controls are on.'
      : permission.tilt === 'denied'
        ? 'Motion access was refused, so touch controls are on.'
        : 'This device has no tilt sensor, so touch controls are on.',
  );
});

$('goTouch').addEventListener('click', () => {
  keepAwake();
  started = true;
  useTouch();
});

$('calibrate').addEventListener('click', () => tiltSensor?.calibrate());
$('toPad').addEventListener('click', () => useTouch());
$('toTilt').addEventListener('click', async () => {
  if (permission.tilt !== 'granted') permission = await requestMotionPermission();
  if (permission.tilt === 'granted') {
    method = 'motion';
    savePref();
    render();
  } else {
    useTouch('Motion access was refused, so touch controls are on.');
  }
});
$('retry').addEventListener('click', () => location.reload());

// People who chose touch last time see it first.
if (loadPref() === 'touch') {
  $('go').classList.remove('big');
  $('goTouch').classList.add('big');
  $('goTouch').after($('go'));
}

// ---------- start ----------

if (!room) {
  stopped = true;
  $('stoppedTitle').textContent = 'No room code';
  $('stoppedText').textContent = 'Scan the QR code on the screen to join.';
  show('stopped');
  setLink('Not connected', 'bad');
} else {
  $('room').textContent = room;
  startPhone();
}

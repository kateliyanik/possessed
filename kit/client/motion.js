// Phone tilt input with calibration and an explicit permission step.
// iPhones only expose motion data over HTTPS, after a user tap.

import { clamp } from '../shared/protocol.js';

// Degrees of tilt that map to full deflection (1.0).
export const FULL_TILT_DEG = 25;

export function motionSupported() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export function needsPermission() {
  return motionSupported() && typeof DeviceOrientationEvent.requestPermission === 'function';
}

// Must be called from a user gesture (tap) on iOS.
// Resolves to { tilt, shake }, each 'granted', 'denied' or 'unsupported'.
// Both requests start in the same tick, so both still count as part of the
// tap: awaiting the first would lose the gesture for the second on Safari.
export async function requestMotionPermission() {
  if (!motionSupported() || !window.isSecureContext) return { tilt: 'unsupported', shake: 'unsupported' };
  const ask = (Ctor) => {
    if (!Ctor) return Promise.resolve('unsupported');
    if (typeof Ctor.requestPermission !== 'function') return Promise.resolve('granted');
    return Ctor.requestPermission().then(
      (r) => (r === 'granted' ? 'granted' : 'denied'),
      () => 'denied',
    );
  };
  const [tilt, shake] = await Promise.all([
    ask(window.DeviceOrientationEvent),
    ask(window.DeviceMotionEvent),
  ]);
  return { tilt, shake };
}

// Turns raw acceleration (m/s², gravity removed) into shake energy 0..1.
// Below ~3 m/s² is ordinary handling; ~20 m/s² is a vigorous shake.
export function shakeEnergy(ax, ay, az) {
  const m = Math.hypot(ax || 0, ay || 0, az || 0);
  return clamp((m - 3) / 17, 0, 1);
}

// Listens for shakes. Calls onShake(v) about 10 times a second while the
// phone is shaking, then once with 0 when it stops.
export function startShake({ onShake }) {
  let level = 0;
  let wasShaking = false;
  let gravity = null;

  function onMotion(ev) {
    let a = ev.acceleration;
    if (!a || a.x === null) {
      // Some phones only report acceleration including gravity; remove it
      // with a simple low-pass estimate of gravity.
      const g = ev.accelerationIncludingGravity;
      if (!g || g.x === null) return;
      gravity = gravity
        ? { x: gravity.x * 0.8 + g.x * 0.2, y: gravity.y * 0.8 + g.y * 0.2, z: gravity.z * 0.8 + g.z * 0.2 }
        : { x: g.x, y: g.y, z: g.z };
      a = { x: g.x - gravity.x, y: g.y - gravity.y, z: g.z - gravity.z };
    }
    level = Math.max(level, shakeEnergy(a.x, a.y, a.z));
  }

  window.addEventListener('devicemotion', onMotion);
  const timer = setInterval(() => {
    if (level > 0.02) {
      onShake(level);
      wasShaking = true;
    } else if (wasShaking) {
      onShake(0);
      wasShaking = false;
    }
    level *= 0.5; // decay between readings
  }, 100);

  return {
    stop() {
      clearInterval(timer);
      window.removeEventListener('devicemotion', onMotion);
    },
  };
}

// Maps raw device angles to screen-relative x/y in -1..1 for a phone held
// flat like a tray. Takes the screen rotation into account.
export function anglesToTilt(beta, gamma, screenAngle = 0, base = { beta: 0, gamma: 0 }) {
  const db = beta - base.beta;
  const dg = gamma - base.gamma;
  let x;
  let y;
  switch (((screenAngle % 360) + 360) % 360) {
    case 90:
      x = db;
      y = -dg;
      break;
    case 180:
      x = -dg;
      y = -db;
      break;
    case 270:
      x = -db;
      y = dg;
      break;
    default:
      x = dg;
      y = db;
  }
  return { x: clamp(x / FULL_TILT_DEG, -1, 1), y: clamp(y / FULL_TILT_DEG, -1, 1) };
}

// Starts listening. Calls onTilt({x, y}) on each reading.
// Calls onNoData() if no readings arrive within timeoutMs.
export function startTilt({ onTilt, onNoData = () => {}, timeoutMs = 1500 }) {
  let base = { beta: 0, gamma: 0 };
  let last = null;
  let gotData = false;

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  function onOrientation(ev) {
    if (ev.beta === null || ev.gamma === null) return;
    gotData = true;
    last = { beta: ev.beta, gamma: ev.gamma };
    onTilt(anglesToTilt(ev.beta, ev.gamma, screenAngle(), base));
  }

  window.addEventListener('deviceorientation', onOrientation);
  const noDataTimer = setTimeout(() => {
    if (!gotData) onNoData();
  }, timeoutMs);

  return {
    // Treat the phone's current position as "level".
    calibrate() {
      if (last) base = { ...last };
    },
    stop() {
      clearTimeout(noDataTimer);
      window.removeEventListener('deviceorientation', onOrientation);
    },
    hasData: () => gotData,
  };
}

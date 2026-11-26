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
// Resolves to 'granted', 'denied' or 'unsupported'.
export async function requestMotionPermission() {
  if (!motionSupported()) return 'unsupported';
  if (!window.isSecureContext) return 'unsupported';
  if (!needsPermission()) return 'granted';
  try {
    const result = await DeviceOrientationEvent.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
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

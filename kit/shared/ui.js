// Phone controls requested by the screen.
//
// An app puts a `ui` object in the state it broadcasts:
//
//   screen.broadcast({ ui: { mode: 'choice', prompt: 'Pick one', options: ['Yes', 'No'], round: 3 } })
//
// Every phone, including ones that join later, shows those controls.
// Pure module. parseUi treats its input as untrusted: the phone renders the
// result, so text is cleaned and bounded here, and rendered with textContent.

import { LIMITS } from './protocol.js';

export const UI_MODES = Object.freeze(['tilt', 'choice', 'tap', 'shake', 'wait']);
export const UI_LIMITS = Object.freeze({ prompt: 140, option: 40, options: LIMITS.maxOptions });

export const DEFAULT_UI = Object.freeze({ mode: 'tilt', prompt: '', options: Object.freeze([]), round: 0 });

// Control characters and bidirectional overrides can hide or reorder text.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  // Cut by code points so emoji are not split in half.
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : text;
}

// Returns a clean ui object, or null if the input is not a usable ui.
export function parseUi(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!UI_MODES.includes(raw.mode)) return null;

  const ui = {
    mode: raw.mode,
    prompt: cleanText(raw.prompt, UI_LIMITS.prompt),
    options: [],
    round: Number.isInteger(raw.round) && raw.round >= 0 && raw.round <= LIMITS.maxRound ? raw.round : 0,
  };

  if (ui.mode === 'choice') {
    // Keep positions: the option's index is what the phone sends back.
    const list = Array.isArray(raw.options) ? raw.options.slice(0, UI_LIMITS.options) : [];
    ui.options = list.map((o, i) => cleanText(o, UI_LIMITS.option) || `Option ${i + 1}`);
    // A question with no options cannot be answered.
    if (ui.options.length === 0) ui.mode = 'wait';
  }
  return ui;
}

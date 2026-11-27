// Spirit Board sound: a low drone, a chime for each chosen glyph and a deeper
// tone for the reveal. Everything is generated with Web Audio, so there are no
// audio files. Silent until the host turns it on (browser autoplay rules).
export function createSound() {
  let ctx = null;
  let master = null;
  let drone = null;
  let enabled = false;
  function ensure() {
    if (ctx) return true;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return true;
  }
  function startDrone() {
    if (drone) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const oscs = [55, 55.4, 82.5].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.35 : 0.2;
      o.connect(g).connect(filter);
      o.start();
      return o;
    });
    // A slow swell, so the drone breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const depth = ctx.createGain();
    depth.gain.value = 0.25;
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
    filter.connect(gain).connect(master);
    drone = { oscs: [...oscs, lfo] };
  }
  function stopDrone() {
    if (!drone) return;
    for (const o of drone.oscs) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    drone = null;
  }
  // One bell-like note: a sine with a quiet partial, fading out.
  function note(freq, { length = 1.6, volume = 0.5, partial = 2.76 } = {}) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(volume, t + 0.02);
    out.gain.exponentialRampToValueAtTime(0.0001, t + length);
    out.connect(master);
    for (const [f, v] of [[freq, 1], [freq * partial, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = v;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + length + 0.05);
    }
  }
  return {
    get enabled() {
      return enabled;
    },
    // Must be called from a click, so the browser allows audio.
    setEnabled(on) {
      if (on) {
        if (!ensure()) return false;
        // Not awaited: a browser may keep the context suspended until a real
        // click, and the button must still respond. It starts when allowed.
        ctx.resume().catch(() => {});
        enabled = true;
        startDrone();
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.5);
      } else {
        enabled = false;
        if (ctx) {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
          setTimeout(() => {
            if (!enabled) stopDrone();
          }, 400);
        }
      }
      return enabled;
    },
    // A glyph was chosen: a higher note for the later letters, so spelling has a tune.
    chime(index = 0) {
      note(440 * 2 ** ((Math.max(0, index) % 12) / 12), { length: 1.4, volume: 0.4 });
    },
    // The answer is revealed: a deep, long tone.
    reveal() {
      note(110, { length: 4, volume: 0.7, partial: 1.5 });
      note(165, { length: 4.5, volume: 0.35, partial: 2 });
    },
  };
}

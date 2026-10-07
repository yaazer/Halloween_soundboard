// Every sound here is synthesized by code, so the app needs no audio files
// and works fully offline. Voice-like scares are built sample-by-sample in
// voices.js; the rest are wired up live from Web Audio API nodes.
//
// Each sound receives an "env" object:
//   env.ac   - the AudioContext
//   env.dry  - node to connect the direct sound to
//   env.wet  - node feeding the shared reverb
//   env.t    - start time (in ac.currentTime units)
//
// Scares return their length in seconds. Drones return { stop() }.

import * as V from './voices.js';

// ---------- small helpers ----------

const noiseCache = new WeakMap();
function noiseBuffer(ac) {
  if (!noiseCache.has(ac)) {
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, buf);
  }
  return noiseCache.get(ac);
}

function noise(ac) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffer(ac);
  s.loop = true;
  s.loopStart = Math.random(); // different noise each time
  return s;
}

function gain(ac, v = 1) {
  const g = ac.createGain();
  g.gain.value = v;
  return g;
}

function osc(ac, type, freq) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

function filt(ac, type, freq, Q = 1) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}

// Low-frequency oscillator that wobbles an AudioParam.
function lfo(ac, rate, depth, param, t, stopAt) {
  const o = osc(ac, 'sine', rate);
  const g = gain(ac, depth);
  o.connect(g).connect(param);
  o.start(t);
  if (stopAt) o.stop(stopAt);
  return o;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

// Send a node to the speakers, with some of it going to the reverb.
function send(e, node, wetAmount) {
  node.connect(e.dry);
  if (wetAmount > 0) node.connect(gain(e.ac, wetAmount)).connect(e.wet);
}

// Vowel-like filter: a voice "buzz" through these sounds like a mouth.
// Each entry is [frequency, level, sharpness].
const VOWELS = {
  oo: [[320, 1, 5], [800, 0.35, 7], [2400, 0.1, 8]],
};

function formantBank(ac, vowel, out, makeup = 5) {
  const input = gain(ac, 1);
  const filters = VOWELS[vowel].map(([f, lvl, q]) => {
    const bp = filt(ac, 'bandpass', f, q);
    input.connect(bp).connect(gain(ac, lvl * makeup)).connect(out);
    return bp;
  });
  return { input, filters };
}

// Guitar-pedal style distortion, for grit.
function distortion(ac, amount) {
  const ws = ac.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

// Plays a scare that is pre-built sample-by-sample (see voices.js).
// The next variation is prepared in the background right after each play,
// so tapping is instant and repeats never sound identical.
function prerendered(render, wetAmount) {
  const ready = new WeakMap();
  const make = (ac) => {
    const [L, R] = render(ac.sampleRate);
    const buf = ac.createBuffer(2, L.length, ac.sampleRate);
    buf.getChannelData(0).set(L);
    buf.getChannelData(1).set(R);
    return buf;
  };
  const play = (e) => {
    const buf = ready.get(e.ac) || make(e.ac);
    ready.delete(e.ac);
    const src = e.ac.createBufferSource();
    src.buffer = buf;
    send(e, src, wetAmount);
    src.start(e.t);
    setTimeout(() => play.warm(e.ac), 50);
    return buf.duration;
  };
  play.warm = (ac) => {
    if (!ready.has(ac)) ready.set(ac, make(ac));
  };
  return play;
}

// Shared reverb so everything sounds like it is in a crypt.
export function makeReverb(ac, seconds = 3.5) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;
  return conv;
}

// ---------- SCARES (one-shots) ----------

function thunder(e) {
  const { ac, t } = e;
  const d = 6;
  // The sharp crack.
  const crack = noise(ac);
  const cg = gain(ac, 0);
  cg.gain.setValueAtTime(0, t);
  cg.gain.linearRampToValueAtTime(0.7, t + 0.005);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  crack.connect(filt(ac, 'highpass', 1200)).connect(cg);
  send(e, cg, 0.5);
  crack.start(t);
  crack.stop(t + 0.6);

  // Sizzling crackles as the bolt splits the air.
  const crackle = noise(ac);
  const kg = gain(ac, 0);
  let ct = t;
  for (let k = 0; k < 18; k++) {
    ct += rand(0.01, 0.07) * (1 + k * 0.08);
    const v = rand(0.3, 1) * (1 - k / 22);
    kg.gain.setValueAtTime(v, ct);
    kg.gain.exponentialRampToValueAtTime(0.01, ct + rand(0.01, 0.04));
  }
  kg.gain.setValueAtTime(0, ct + 0.05);
  crackle.connect(filt(ac, 'bandpass', 2500, 0.8)).connect(distortion(ac, 3)).connect(kg);
  send(e, kg, 0.6);
  crackle.start(t);
  crackle.stop(ct + 0.1);

  // The long rolling rumble.
  const rum = noise(ac);
  const rg = gain(ac, 0);
  rg.gain.setValueAtTime(0, t);
  rg.gain.linearRampToValueAtTime(1, t + 0.15);
  for (let k = 0; k < 10; k++) {
    rg.gain.setTargetAtTime(rand(0.35, 1), t + 0.25 + k * 0.3, 0.08);
  }
  rg.gain.setTargetAtTime(0, t + 3.2, 0.7);
  rum
    .connect(filt(ac, 'lowpass', 220, 0.7))
    .connect(filt(ac, 'lowpass', 400))
    .connect(gain(ac, 5))
    .connect(rg);
  send(e, rg, 0.4);
  rum.start(t);
  rum.stop(t + d);

  // A sub-bass boom you feel in your chest.
  const boom = osc(ac, 'sine', 55);
  boom.frequency.setValueAtTime(60, t);
  boom.frequency.exponentialRampToValueAtTime(28, t + 1.5);
  const bg = gain(ac, 0);
  bg.gain.setValueAtTime(0, t);
  bg.gain.linearRampToValueAtTime(0.8, t + 0.02);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 2);
  boom.connect(bg);
  send(e, bg, 0.1);
  boom.start(t);
  boom.stop(t + 2);
  return d;
}

// "Psycho"-style screeching violins: a cluster of high, harsh, wobbling notes.
function screechStrings(ac, t, len, base, out) {
  const bus = gain(ac, 0);
  bus.gain.setValueAtTime(0, t);
  bus.gain.linearRampToValueAtTime(1, t + 0.012);
  bus.gain.setValueAtTime(1, t + len * 0.6);
  bus.gain.exponentialRampToValueAtTime(0.001, t + len);
  const tone = filt(ac, 'peaking', 3000, 1);
  tone.gain.value = 8;
  bus.connect(distortion(ac, 3)).connect(tone).connect(filt(ac, 'lowpass', 9000)).connect(out);
  for (let i = 0; i < 9; i++) {
    const f = base * Math.pow(2, rand(-3, 6) / 12);
    const o = osc(ac, 'sawtooth', f);
    o.detune.value = rand(-25, 25);
    // Fast, uneven bow vibrato is what makes strings "scream".
    lfo(ac, rand(6, 9), f * rand(0.015, 0.03), o.frequency, t, t + len);
    lfo(ac, rand(1, 3), f * 0.01, o.frequency, t, t + len);
    o.connect(gain(ac, 0.09)).connect(bus);
    o.start(t);
    o.stop(t + len);
  }
  // Rosin "scratch" of the bows.
  const n = noise(ac);
  n.connect(filt(ac, 'bandpass', base * 2, 2)).connect(gain(ac, 0.25)).connect(bus);
  n.start(t);
  n.stop(t + len);
}

function jumpScare(e) {
  const { ac, t } = e;
  const d = 3.8;
  const out = gain(ac, 1);
  send(e, out, 0.45);

  // Film-trailer "BRAAM": distorted low brass, with clashing notes.
  const brass = gain(ac, 0);
  brass.gain.setValueAtTime(0, t);
  brass.gain.linearRampToValueAtTime(1, t + 0.02);
  brass.gain.setTargetAtTime(0.5, t + 0.3, 0.4);
  brass.gain.setTargetAtTime(0, t + 1.8, 0.5);
  const bf = filt(ac, 'lowpass', 300, 2);
  bf.frequency.setValueAtTime(300, t);
  bf.frequency.exponentialRampToValueAtTime(3500, t + 0.06);
  bf.frequency.exponentialRampToValueAtTime(600, t + 2);
  brass.connect(bf).connect(distortion(ac, 4)).connect(gain(ac, 0.6)).connect(out);
  for (const f of [55, 58.3, 82.4, 110, 116.5]) {
    for (const det of [-9, 8]) {
      const o = osc(ac, 'sawtooth', f);
      o.detune.value = det + rand(-4, 4);
      o.connect(gain(ac, 0.12)).connect(brass);
      o.start(t);
      o.stop(t + d);
    }
  }

  screechStrings(ac, t, 2.2, rand(1500, 1900), out);

  // Chest-thumping sub drop.
  const boom = osc(ac, 'sine', 90);
  boom.frequency.setValueAtTime(110, t);
  boom.frequency.exponentialRampToValueAtTime(28, t + 1);
  const bg = gain(ac, 0);
  bg.gain.setValueAtTime(0, t);
  bg.gain.linearRampToValueAtTime(1.2, t + 0.004);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 2);
  boom.connect(distortion(ac, 1.5)).connect(bg).connect(out);
  boom.start(t);
  boom.stop(t + 2);

  // Crash and hiss.
  const crash = noise(ac);
  const ng = gain(ac, 0);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.45, t + 0.003);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
  crash.connect(filt(ac, 'highpass', 2500)).connect(ng).connect(out);
  crash.start(t);
  crash.stop(t + 1.7);
  return d;
}

// Repeated screeching stabs, like the shower scene in Psycho.
function shriekStrings(e) {
  const { ac, t } = e;
  const out = gain(ac, 1);
  send(e, out, 0.5);
  const base = rand(1700, 2100);
  let at = t;
  for (let i = 0; i < 6; i++) {
    screechStrings(ac, at, 0.32, base * (i % 2 ? 0.944 : 1), out);
    at += rand(0.2, 0.26);
  }
  return at - t + 0.35;
}

function chains(e) {
  const { ac, t } = e;
  const d = 1.9;
  const out = gain(ac, 1);
  for (let i = 0; i < 28; i++) {
    const s = t + Math.pow(Math.random(), 1.4) * (d - 0.3);
    const base = rand(1800, 3400);
    const vol = rand(0.05, 0.14);
    // Metal rings at odd, non-musical overtones.
    [1, 2.76, 5.4, 8.93].forEach((ratio, k) => {
      if (base * ratio > 16000) return; // too high to hear
      const o = osc(ac, 'sine', base * ratio);
      const g = gain(ac, 0);
      const len = rand(0.06, 0.25) / (k + 1);
      g.gain.setValueAtTime(vol / (k + 1), s);
      g.gain.exponentialRampToValueAtTime(0.0001, s + len);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + len + 0.01);
    });
  }
  // A dragging scrape underneath.
  const n = noise(ac);
  const ng = gain(ac, 0);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.08, t + 0.3);
  ng.gain.linearRampToValueAtTime(0, t + d);
  n.connect(filt(ac, 'bandpass', 3000, 2)).connect(ng).connect(out);
  n.start(t);
  n.stop(t + d);
  send(e, out, 0.3);
  return d;
}

function knock(e) {
  const { ac, t } = e;
  const times = [0, 0.3, 0.6, 1.4, 1.65];
  times.forEach((dt) => {
    const s = t + dt + rand(-0.02, 0.02);
    const o = osc(ac, 'sine', 170);
    o.frequency.setValueAtTime(rand(160, 190), s);
    o.frequency.exponentialRampToValueAtTime(80, s + 0.1);
    const g = gain(ac, 0);
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(1, s + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.18);
    o.connect(g);
    send(e, g, 0.3);
    o.start(s);
    o.stop(s + 0.2);

    const n = noise(ac);
    const ng = gain(ac, 0);
    ng.gain.setValueAtTime(0, s);
    ng.gain.linearRampToValueAtTime(0.7, s + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.001, s + 0.04);
    n.connect(filt(ac, 'bandpass', 1100, 1.2)).connect(ng);
    send(e, ng, 0.3);
    n.start(s);
    n.stop(s + 0.05);
  });
  return 2.2;
}

// Balances loudness so every sound sits at a similar volume.
function leveled(fn, level) {
  const play = (e) => {
    const dry = gain(e.ac, level);
    const wet = gain(e.ac, level);
    dry.connect(e.dry);
    wet.connect(e.wet);
    return fn({ ...e, dry, wet });
  };
  play.warm = fn.warm;
  return play;
}

export const SCARES = [
  { id: 'scream', name: 'Scream', emoji: '😱', play: leveled(prerendered(V.scream, 0.35), 1) },
  { id: 'jump', name: 'Jump Scare', emoji: '💥', play: leveled(jumpScare, 0.8) },
  { id: 'roar', name: 'Monster Roar', emoji: '👹', play: leveled(prerendered(V.monsterRoar, 0.3), 0.75) },
  { id: 'strings', name: 'Shriek Strings', emoji: '🎻', play: leveled(shriekStrings, 0.8) },
  { id: 'laugh', name: 'Evil Laugh', emoji: '😈', play: leveled(prerendered(V.evilLaugh, 0.45), 0.9) },
  { id: 'cackle', name: 'Witch Cackle', emoji: '🧙', play: leveled(prerendered(V.witchCackle, 0.35), 0.8) },
  { id: 'breath', name: 'Heavy Breathing', emoji: '😮‍💨', play: leveled(prerendered(V.heavyBreathing, 0.15), 1) },
  { id: 'whisper', name: 'Whispers', emoji: '🤫', play: leveled(prerendered(V.whisper, 0.4), 1) },
  { id: 'zombie', name: 'Zombie Groan', emoji: '🧟', play: leveled(prerendered(V.zombieGroan, 0.35), 0.85) },
  { id: 'ghost', name: 'Ghost Wail', emoji: '👻', play: leveled(prerendered(V.ghostWail, 0.75), 0.8) },
  { id: 'wolf', name: 'Wolf Howl', emoji: '🐺', play: leveled(prerendered(V.wolfHowl, 0.6), 0.7) },
  { id: 'thunder', name: 'Thunder', emoji: '⚡', play: leveled(thunder, 0.8) },
  { id: 'door', name: 'Creaky Door', emoji: '🚪', play: leveled(prerendered(V.creakyDoor, 0.3), 1) },
  { id: 'chains', name: 'Chains', emoji: '⛓️', play: leveled(chains, 3) },
  { id: 'knock', name: 'Knocking', emoji: '✊', play: leveled(knock, 1) },
];

// ---------- DRONES (looping backgrounds) ----------

// Wraps a drone so it fades in on start and fades out on stop.
function drone(e, wetAmount, build) {
  const { ac } = e;
  const t = ac.currentTime;
  const out = gain(ac, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + 3);
  send(e, out, wetAmount);
  const sources = [];
  const timers = [];
  const start = (node) => {
    node.start(t);
    sources.push(node);
    return node;
  };
  build({ ac, t, out, start, timers });
  return {
    stop() {
      const now = ac.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + 1.5);
      timers.forEach(clearInterval);
      setTimeout(() => {
        sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
        out.disconnect();
      }, 1700);
    },
  };
}

// Runs `schedule(time)` ahead of the clock so timing stays tight even if
// the phone is busy. Returns the interval id.
function scheduler(ac, firstAt, schedule) {
  let next = firstAt;
  const tick = () => {
    while (next < ac.currentTime + 1.5) next = schedule(next);
  };
  tick();
  return setInterval(tick, 300);
}

function abyss(e) {
  return drone(e, 0.4, ({ ac, t, out, start }) => {
    const lp = filt(ac, 'lowpass', 280, 5);
    lfo(ac, 0.05, 180, lp.frequency, t); // slow filter sweep
    const trem = gain(ac, 0.8);
    lfo(ac, 0.09, 0.2, trem.gain, t);
    lp.connect(trem).connect(out);
    // Low notes a "devil's interval" (tritone) apart, slightly detuned.
    for (const f of [41.2, 41.5, 58.3, 82.8, 116.3]) {
      const o = start(osc(ac, 'sawtooth', f));
      o.connect(gain(ac, 0.18)).connect(lp);
    }
    const sub = start(osc(ac, 'sine', 41.2));
    sub.connect(gain(ac, 0.45)).connect(out);
  });
}

function wind(e) {
  return drone(e, 0.3, ({ ac, t, out, start }) => {
    const layers = [[450, 6, 0.07, 280, 6], [900, 18, 0.11, 400, 10], [250, 3, 0.05, 120, 3]];
    for (const [f, q, rate, depth, makeup] of layers) {
      const n = start(noise(ac));
      const bp = filt(ac, 'bandpass', f, q);
      lfo(ac, rate, depth, bp.frequency, t);
      lfo(ac, rate * 2.7, depth * 0.4, bp.frequency, t);
      const g = gain(ac, 0.5);
      lfo(ac, rate * 1.6, 0.35, g.gain, t);
      n.connect(bp).connect(gain(ac, makeup * 0.12)).connect(g).connect(out);
    }
  });
}

function heartbeat(e) {
  return drone(e, 0.15, ({ ac, t, out, timers }) => {
    const startedAt = t;
    const thump = (s, vol) => {
      const o = osc(ac, 'sine', 60);
      o.frequency.setValueAtTime(65, s);
      o.frequency.exponentialRampToValueAtTime(35, s + 0.15);
      const g = gain(ac, 0);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.25);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + 0.3);
    };
    timers.push(
      scheduler(ac, t + 0.1, (s) => {
        thump(s, 1);
        thump(s + 0.26, 0.7);
        // Heart rate slowly climbs from 58 to 95 bpm over ~3 minutes.
        const bpm = Math.min(95, 58 + ((s - startedAt) / 180) * 37);
        return s + 60 / bpm;
      }),
    );
  });
}

function choir(e) {
  return drone(e, 0.85, ({ ac, t, out, start }) => {
    const bank = formantBank(ac, 'oo', out, 1.6);
    const freqs = [220, 233.1, 311.1, 329.6, 438];
    freqs.forEach((f, i) => {
      const v = gain(ac, 0.15);
      // Each voice fades in and out on its own slow cycle.
      lfo(ac, rand(0.03, 0.09), 0.14, v.gain, t);
      v.connect(bank.input);
      for (const det of [-8, 7]) {
        const o = start(osc(ac, 'sawtooth', f));
        o.detune.value = det;
        lfo(ac, 4.5 + i * 0.2, f * 0.006, o.frequency, t);
        o.connect(v);
      }
    });
  });
}

function musicBox(e) {
  return drone(e, 0.6, ({ ac, t, out, start, timers }) => {
    // A minor-key lullaby, one octave up. null = rest.
    const melody = [
      69, 76, 81, 84, 83, 81, 76, 77, 76, 74, 72, 71, 72, 76, 69, null,
      69, 76, 81, 84, 86, 84, 83, 80, 81, 76, 72, 71, 69, null, null, null,
    ];
    const warble = gain(ac, 1);
    const det = ac.createConstantSource ? start(ac.createConstantSource()) : null;
    if (det) det.offset.value = 0;
    if (det) lfo(ac, 0.13, 25, det.offset, t); // out-of-tune "warped tape" drift
    warble.connect(out);
    let i = 0;
    timers.push(
      scheduler(ac, t + 0.2, (s) => {
        const note = melody[i % melody.length];
        i++;
        if (note !== null) {
          const f = 440 * Math.pow(2, (note + 12 - 69) / 12);
          [[1, 0.35, 1.6], [2, 0.12, 0.6], [3, 0.06, 0.3], [5.4, 0.03, 0.15]].forEach(
            ([ratio, vol, len]) => {
              const o = osc(ac, 'sine', f * ratio);
              if (det) det.connect(o.detune);
              const g = gain(ac, 0);
              g.gain.setValueAtTime(0, s);
              g.gain.linearRampToValueAtTime(vol, s + 0.004);
              g.gain.exponentialRampToValueAtTime(0.0001, s + len);
              o.connect(g).connect(warble);
              o.start(s);
              o.stop(s + len + 0.05);
            },
          );
        }
        return s + 0.42;
      }),
    );
  });
}

function graveyard(e) {
  return drone(e, 0.35, ({ ac, t, out, start, timers }) => {
    // Faint wind underneath.
    const n = start(noise(ac));
    const lp = filt(ac, 'lowpass', 350, 1);
    lfo(ac, 0.07, 150, lp.frequency, t);
    n.connect(lp).connect(gain(ac, 0.25)).connect(out);

    // A few crickets, each with its own pitch and stereo position.
    const crickets = [4300, 4700, 5100].map((f, i) => {
      const o = start(osc(ac, 'sine', f));
      const g = gain(ac, 0);
      let node = g;
      if (ac.createStereoPanner) {
        const p = ac.createStereoPanner();
        p.pan.value = [-0.7, 0.6, 0][i];
        g.connect(p);
        node = p;
      }
      node.connect(gain(ac, 0.05)).connect(out);
      o.connect(g);
      return g;
    });
    crickets.forEach((g, i) => {
      timers.push(
        scheduler(ac, t + 0.3 + i * 0.37, (s) => {
          for (let k = 0; k < 3; k++) {
            const c = s + k * 0.045;
            g.gain.setValueAtTime(0, c);
            g.gain.linearRampToValueAtTime(1, c + 0.008);
            g.gain.linearRampToValueAtTime(0, c + 0.03);
          }
          return s + rand(0.7, 1.1);
        }),
      );
    });

    // An owl: "hoo... hoo-hoo" every so often.
    timers.push(
      scheduler(ac, t + rand(3, 6), (s) => {
        [0, 0.6, 0.85].forEach((dt, k) => {
          const st = s + dt;
          const o = osc(ac, 'sine', 380);
          o.frequency.setValueAtTime(400, st);
          o.frequency.linearRampToValueAtTime(360, st + 0.3);
          const g = gain(ac, 0);
          g.gain.setValueAtTime(0, st);
          g.gain.linearRampToValueAtTime(k ? 0.12 : 0.16, st + 0.06);
          g.gain.linearRampToValueAtTime(0, st + (k === 1 ? 0.18 : 0.35));
          o.connect(g).connect(out);
          o.start(st);
          o.stop(st + 0.4);
        });
        return s + rand(9, 18);
      }),
    );
  });
}

export const DRONES = [
  { id: 'abyss', name: 'The Abyss', emoji: '🕳️', play: leveled(abyss, 0.3) },
  { id: 'wind', name: 'Haunted Wind', emoji: '🌫️', play: leveled(wind, 3) },
  { id: 'choir', name: 'Ghost Choir', emoji: '🕯️', play: leveled(choir, 0.3) },
  { id: 'heart', name: 'Heartbeat', emoji: '🫀', play: leveled(heartbeat, 2) },
  { id: 'musicbox', name: 'Music Box', emoji: '🎠', play: leveled(musicBox, 2.5) },
  { id: 'graveyard', name: 'Graveyard Night', emoji: '🪦', play: leveled(graveyard, 2.5) },
];

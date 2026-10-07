// Every sound here is synthesized live with the Web Audio API, so the app
// needs no audio files and works fully offline.
//
// Each sound receives an "env" object:
//   env.ac   - the AudioContext
//   env.dry  - node to connect the direct sound to
//   env.wet  - node feeding the shared reverb
//   env.t    - start time (in ac.currentTime units)
//
// Scares return their length in seconds. Drones return { stop() }.

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
  ah: [[800, 1, 6], [1200, 0.6, 8], [2800, 0.25, 10]],
  eh: [[530, 1, 6], [1850, 0.5, 9], [2500, 0.25, 10]],
  oo: [[320, 1, 5], [800, 0.35, 7], [2400, 0.1, 8]],
  uh: [[450, 1, 5], [900, 0.6, 6], [2500, 0.2, 8]],
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

// A smoothed random walk, handy for "wobbly" pitch curves.
function wobbleCurve(points, lo, hi, smooth = 0.85) {
  const c = new Float32Array(points);
  let v = rand(lo, hi);
  let target = v;
  for (let i = 0; i < points; i++) {
    if (Math.random() < 0.1) target = rand(lo, hi);
    v = v * smooth + target * (1 - smooth);
    c[i] = v;
  }
  return c;
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

function scream(e) {
  const { ac, t } = e;
  const d = rand(1.6, 2.2);
  const base = rand(620, 820);
  const out = gain(ac, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.9, t + 0.08);
  out.gain.setValueAtTime(0.9, t + d - 0.7);
  out.gain.exponentialRampToValueAtTime(0.001, t + d);

  const bank = formantBank(ac, 'ah', out, 4);
  for (const detune of [-14, 11]) {
    const o = osc(ac, 'sawtooth', base);
    o.detune.value = detune;
    o.frequency.setValueAtTime(base * 0.75, t);
    o.frequency.linearRampToValueAtTime(base * 1.15, t + 0.25);
    o.frequency.linearRampToValueAtTime(base, t + d * 0.7);
    o.frequency.linearRampToValueAtTime(base * 0.65, t + d);
    lfo(ac, rand(6, 8), base * 0.04, o.frequency, t, t + d);
    o.connect(bank.input);
    o.start(t);
    o.stop(t + d);
  }
  const rasp = noise(ac);
  rasp.connect(filt(ac, 'highpass', 2500)).connect(gain(ac, 0.12)).connect(out);
  rasp.start(t);
  rasp.stop(t + d);

  send(e, out, 0.35);
  return d;
}

function laugh(e, o) {
  const { ac, t } = e;
  const out = gain(ac, 1);
  const bank = formantBank(ac, o.vowel, out, o.makeup);

  const voice = gain(ac, 0);
  voice.connect(bank.input);
  const breath = gain(ac, 0);
  breath.connect(bank.input);

  const srcs = [osc(ac, 'sawtooth', o.f0)];
  if (o.sub) srcs.push(osc(ac, 'sawtooth', o.f0 / 2));
  const n = noise(ac);
  n.connect(filt(ac, 'bandpass', 1500, 1)).connect(breath);

  let st = t;
  for (let i = 0; i < o.count; i++) {
    const p = o.f0 * (1.15 - (i / o.count) * 0.35) * rand(0.95, 1.05);
    srcs.forEach((s, k) => {
      const f = k === 0 ? p : p / 2;
      s.frequency.setValueAtTime(f * 1.12, st);
      s.frequency.exponentialRampToValueAtTime(f * 0.88, st + o.syl);
    });
    breath.gain.setValueAtTime(0, st);
    breath.gain.linearRampToValueAtTime(0.6, st + 0.015);
    breath.gain.linearRampToValueAtTime(0, st + 0.05);
    voice.gain.setValueAtTime(0, st + 0.02);
    voice.gain.linearRampToValueAtTime(1, st + 0.045);
    voice.gain.setValueAtTime(1, st + o.syl * 0.6);
    voice.gain.linearRampToValueAtTime(0, st + o.syl);
    st += o.syl + o.gap;
  }
  // The long final "haaaaa".
  const fd = o.finalLen;
  srcs.forEach((s, k) => {
    const f = k === 0 ? o.f0 * o.finalFrom : (o.f0 * o.finalFrom) / 2;
    s.frequency.setValueAtTime(f, st);
    s.frequency.exponentialRampToValueAtTime(f * o.finalTo, st + fd);
  });
  breath.gain.setValueAtTime(0, st);
  breath.gain.linearRampToValueAtTime(0.6, st + 0.02);
  breath.gain.linearRampToValueAtTime(0, st + 0.08);
  voice.gain.setValueAtTime(0, st + 0.03);
  voice.gain.linearRampToValueAtTime(1, st + 0.07);
  voice.gain.setValueAtTime(1, st + fd * 0.5);
  voice.gain.linearRampToValueAtTime(0, st + fd);
  const end = st + fd + 0.05;

  srcs.forEach((s) => {
    lfo(ac, 5.5, o.f0 * 0.03, s.frequency, t, end);
    s.connect(voice);
    s.start(t);
    s.stop(end);
  });
  n.start(t);
  n.stop(end);

  send(e, out, o.wet);
  return end - t;
}

const evilLaugh = (e) =>
  laugh(e, {
    f0: rand(100, 125), sub: true, syl: 0.17, gap: 0.08, count: 8,
    vowel: 'ah', makeup: 4, finalLen: 1.1, finalFrom: 1.1, finalTo: 0.55, wet: 0.45,
  });

const witchCackle = (e) =>
  laugh(e, {
    f0: rand(380, 460), sub: false, syl: 0.085, gap: 0.035, count: 13,
    vowel: 'eh', makeup: 4, finalLen: 0.8, finalFrom: 1.0, finalTo: 1.6, wet: 0.35,
  });

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

function creakyDoor(e) {
  const { ac, t } = e;
  const d = rand(2, 2.8);
  // A slow buzz = a series of "stick-slip" clicks, shaped by wood resonances.
  const o = osc(ac, 'sawtooth', 40);
  o.frequency.setValueCurveAtTime(wobbleCurve(64, 18, 90, 0.8), t, d);
  const out = gain(ac, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + 0.15);
  out.gain.setValueCurveAtTime(wobbleCurve(32, 0.5, 1, 0.7), t + 0.2, d - 0.5);
  out.gain.linearRampToValueAtTime(0, t + d);
  for (const [f, q, g] of [[rand(450, 600), 18, 3], [rand(1000, 1300), 22, 2.5], [2300, 15, 1]]) {
    o.connect(filt(ac, 'bandpass', f, q)).connect(gain(ac, g)).connect(out);
  }
  o.start(t);
  o.stop(t + d);
  send(e, out, 0.3);
  return d;
}

function jumpScare(e) {
  const { ac, t } = e;
  const d = 3.5;
  // A clashing, dissonant "orchestra hit".
  const notes = [65.4, 69.3, 92.5, 130.8, 138.6, 185, 277.2, 293.7, 415.3, 440];
  const lp = filt(ac, 'lowpass', 7000, 1);
  lp.frequency.setValueAtTime(7000, t);
  lp.frequency.exponentialRampToValueAtTime(700, t + 2.5);
  const out = gain(ac, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.9, t + 0.01);
  out.gain.exponentialRampToValueAtTime(0.25, t + 0.6);
  out.gain.exponentialRampToValueAtTime(0.001, t + d);
  lp.connect(out);
  for (const f of notes) {
    const o = osc(ac, 'sawtooth', f);
    o.detune.value = rand(-10, 10);
    o.connect(gain(ac, 0.13)).connect(lp);
    o.start(t);
    o.stop(t + d);
  }
  send(e, out, 0.5);

  const boom = osc(ac, 'sine', 80);
  boom.frequency.setValueAtTime(90, t);
  boom.frequency.exponentialRampToValueAtTime(30, t + 0.8);
  const bg = gain(ac, 0);
  bg.gain.setValueAtTime(0, t);
  bg.gain.linearRampToValueAtTime(1, t + 0.005);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
  boom.connect(bg);
  send(e, bg, 0.1);
  boom.start(t);
  boom.stop(t + 1.6);

  const crash = noise(ac);
  const ng = gain(ac, 0);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.35, t + 0.005);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
  crash.connect(filt(ac, 'highpass', 3000)).connect(ng);
  send(e, ng, 0.6);
  crash.start(t);
  crash.stop(t + 1.5);
  return d;
}

function ghostWail(e) {
  const { ac, t } = e;
  const d = rand(3.2, 4);
  const out = gain(ac, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.7, t + 0.8);
  out.gain.setValueAtTime(0.7, t + d - 1.2);
  out.gain.linearRampToValueAtTime(0, t + d);
  const bank = formantBank(ac, 'oo', out, 2.5);
  const base = rand(260, 320);
  // Two voices, slightly out of step, sound more unearthly than one.
  [0, 0.15].forEach((delay, i) => {
    const o = osc(ac, i ? 'sine' : 'triangle', base);
    const s = t + delay;
    o.detune.value = i ? 18 : 0;
    o.frequency.setValueAtTime(base, s);
    o.frequency.exponentialRampToValueAtTime(base * 1.8, s + 1.2);
    o.frequency.exponentialRampToValueAtTime(base * 1.45, s + 2.2);
    o.frequency.exponentialRampToValueAtTime(base * 0.8, t + d);
    lfo(ac, 4.8, 10, o.frequency, t, t + d);
    o.connect(bank.input);
    o.connect(gain(ac, 0.25)).connect(out);
    o.start(t);
    o.stop(t + d);
  });
  send(e, out, 0.75);
  return d;
}

function wolfHowl(e) {
  const { ac, t } = e;
  const d = rand(3.6, 4.4);
  const b = rand(360, 420);
  const out = gain(ac, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.6, t + 0.35);
  out.gain.setValueAtTime(0.6, t + d - 0.9);
  out.gain.linearRampToValueAtTime(0, t + d);
  const lp = filt(ac, 'lowpass', 2200);
  lp.connect(out);
  for (const [mult, type, lvl] of [[1, 'triangle', 1], [2, 'sine', 0.25]]) {
    const o = osc(ac, type, b * mult);
    const f = o.frequency;
    f.setValueAtTime(b * mult, t);
    f.exponentialRampToValueAtTime(b * 1.6 * mult, t + 0.6);
    f.linearRampToValueAtTime(b * 1.7 * mult, t + d - 1.2);
    f.exponentialRampToValueAtTime(b * 1.25 * mult, t + d - 0.3);
    f.exponentialRampToValueAtTime(b * 0.9 * mult, t + d);
    lfo(ac, 5, 6 * mult, f, t + 1, t + d);
    o.connect(gain(ac, lvl)).connect(lp);
    o.start(t);
    o.stop(t + d);
  }
  send(e, out, 0.65);
  return d;
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

function zombieGroan(e) {
  const { ac, t } = e;
  const d = rand(2.4, 3.2);
  const out = gain(ac, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.9, t + 0.4);
  out.gain.setValueCurveAtTime(wobbleCurve(24, 0.6, 1, 0.7), t + 0.45, d - 1.1);
  out.gain.linearRampToValueAtTime(0, t + d);
  const bank = formantBank(ac, 'uh', out, 4);
  // Growl: the voice is chopped rapidly on and off.
  const growl = gain(ac, 0.6);
  lfo(ac, rand(22, 32), 0.4, growl.gain, t, t + d);
  growl.connect(bank.input);
  for (const detune of [0, 25]) {
    const o = osc(ac, 'sawtooth', 90);
    o.detune.value = detune;
    o.frequency.setValueCurveAtTime(wobbleCurve(48, 70, 115, 0.9), t, d);
    o.connect(growl);
    o.start(t);
    o.stop(t + d);
  }
  send(e, out, 0.35);
  return d;
}

function whisper(e) {
  const { ac, t } = e;
  const d = rand(2.6, 3.4);
  const out = gain(ac, 0);
  const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
  const env = gain(ac, 0);
  const bank = formantBank(ac, 'eh', env, 3);
  const n = noise(ac);
  n.connect(bank.input);
  // Hiss for the "s" sounds.
  const hiss = gain(ac, 0);
  n.connect(filt(ac, 'highpass', 5000)).connect(hiss).connect(env);
  // Random mouth shapes, one per syllable.
  const shapes = Object.values(VOWELS);
  let s = t;
  while (s < t + d - 0.7) {
    const len = rand(0.12, 0.26);
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    bank.filters.forEach((f, i) => f.frequency.setTargetAtTime(shape[i][0], s, 0.02));
    env.gain.setTargetAtTime(rand(0.5, 1), s, 0.02);
    env.gain.setTargetAtTime(0.05, s + len * 0.7, 0.03);
    if (Math.random() < 0.3) {
      hiss.gain.setTargetAtTime(0.5, s, 0.02);
      hiss.gain.setTargetAtTime(0, s + len, 0.03);
    }
    s += len + rand(0.02, 0.1);
  }
  // A long trailing "sssss".
  env.gain.setTargetAtTime(0.8, s, 0.05);
  hiss.gain.setTargetAtTime(0.8, s, 0.05);
  env.gain.setTargetAtTime(0, t + d - 0.25, 0.08);
  out.gain.value = 1;
  env.connect(out);
  if (pan) {
    // Sweeps from one side to the other.
    pan.pan.setValueAtTime(-0.8, t);
    pan.pan.linearRampToValueAtTime(0.8, t + d);
    out.connect(pan);
    send(e, pan, 0.5);
  } else {
    send(e, out, 0.5);
  }
  n.start(t);
  n.stop(t + d);
  return d;
}

// Balances loudness so every sound sits at a similar volume.
function leveled(fn, level) {
  return (e) => {
    const dry = gain(e.ac, level);
    const wet = gain(e.ac, level);
    dry.connect(e.dry);
    wet.connect(e.wet);
    return fn({ ...e, dry, wet });
  };
}

export const SCARES = [
  { id: 'scream', name: 'Scream', emoji: '😱', play: leveled(scream, 0.3) },
  { id: 'jump', name: 'Jump Scare', emoji: '💥', play: leveled(jumpScare, 0.8) },
  { id: 'laugh', name: 'Evil Laugh', emoji: '😈', play: leveled(evilLaugh, 0.9) },
  { id: 'cackle', name: 'Witch Cackle', emoji: '🧙', play: leveled(witchCackle, 0.6) },
  { id: 'thunder', name: 'Thunder', emoji: '⚡', play: leveled(thunder, 0.8) },
  { id: 'door', name: 'Creaky Door', emoji: '🚪', play: leveled(creakyDoor, 2) },
  { id: 'ghost', name: 'Ghost Wail', emoji: '👻', play: leveled(ghostWail, 0.5) },
  { id: 'wolf', name: 'Wolf Howl', emoji: '🐺', play: leveled(wolfHowl, 0.7) },
  { id: 'zombie', name: 'Zombie Groan', emoji: '🧟', play: leveled(zombieGroan, 1) },
  { id: 'chains', name: 'Chains', emoji: '⛓️', play: leveled(chains, 3) },
  { id: 'knock', name: 'Knocking', emoji: '✊', play: leveled(knock, 1) },
  { id: 'whisper', name: 'Whisper', emoji: '🤫', play: leveled(whisper, 2) },
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

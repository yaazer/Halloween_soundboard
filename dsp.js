// Sample-by-sample sound building blocks, used for the realistic voices.
//
// renderVoice() models a throat and mouth: a vibrating "vocal fold" pulse
// with the natural imperfections of a real voice (pitch jitter, loudness
// shimmer, breath noise, rough rattling "subharmonics" like a real scream),
// shaped by mouth resonances ("formants") that can move to form vowels.

export function rand(a, b) {
  return a + Math.random() * (b - a);
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Random number with a bell-curve spread (mean 0, roughly unit spread).
export function randn() {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.732;
}

// Turns [[time, value], ...] into a function of time that slides between them.
export function line(pts) {
  return (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [t1, v1] = pts[i];
      if (t <= t1) {
        const [t0, v0] = pts[i - 1];
        return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return pts[pts.length - 1][1];
  };
}

// A smooth random wander around 1.0 (e.g. 0.05 = up to ±5%), so pitches are
// never perfectly steady the way a synthesizer's are.
export function drift(dur, depth, speed = 4) {
  const n = Math.ceil(dur * speed) + 2;
  const knots = Array.from({ length: n }, () => randn() * depth);
  return (t) => {
    const x = t * speed;
    const i = Math.min(Math.floor(x), n - 2);
    const f = (1 - Math.cos(Math.PI * (x - i))) / 2;
    return 1 + knots[i] * (1 - f) + knots[i + 1] * f;
  };
}

// Mouth resonances (Hz) for each vowel, adult-male sized.
export const VOWELS = {
  a: [730, 1090, 2440, 3400, 4500],
  ae: [660, 1720, 2410, 3400, 4500],
  e: [530, 1840, 2480, 3400, 4500],
  i: [270, 2290, 3010, 3400, 4500],
  o: [570, 840, 2410, 3400, 4500],
  u: [300, 870, 2240, 3400, 4500],
  uh: [640, 1190, 2390, 3400, 4500],
  scream: [1000, 1650, 2950, 3900, 4900],
};
const BANDWIDTHS = [80, 100, 150, 250, 300];

// [[time, 'a'], [time, 'u'], ...] -> function of time giving formant freqs.
export function vowelPath(pts) {
  const tracks = [0, 1, 2, 3, 4].map((k) => line(pts.map(([t, v]) => [t, VOWELS[v][k]])));
  return (t) => tracks.map((f) => f(t));
}

const val = (x, t) => (typeof x === 'function' ? x(t) : x);

/*
 * spec fields (numbers, or functions of time in seconds):
 *   dur       length in seconds
 *   f0        pitch in Hz
 *   amp       voice loudness 0..1
 *   breath    breath-noise loudness 0..1
 *   formants  array of 5 resonance freqs (use vowelPath)
 *   fScale    head size: <1 = bigger creature, >1 = smaller (woman/child)
 *   bwScale   >1 = wider-open, harsher mouth
 *   jitter    random pitch wobble per vibration (0.01 = 1%)
 *   shimmer   random loudness wobble per vibration
 *   rough     0..1 rattle / voice-crack (period doubling, as in real screams)
 *   growl     0..1 fast irregular throat flutter (the harsh "roughness" that
 *             makes screams and roars sound alarming)
 *   oq        how long the vocal folds stay open (higher = breathier)
 *   drive     >1 adds throat distortion
 */
export function renderVoice(sr, s) {
  const n = Math.ceil(s.dur * sr);
  const out = new Float32Array(n);
  const fScale = s.fScale ?? 1;
  const bwScale = s.bwScale ?? 1;
  const jitter = s.jitter ?? 0.01;
  const shimmer = s.shimmer ?? 0.05;
  const oq = s.oq ?? 0.6;
  const tp = oq * 0.65;
  const growl = s.growl ?? 0;
  let flutterPhase = 0;
  const res = BANDWIDTHS.map(() => ({ a: 0, b: 0, c: 0, y1: 0, y2: 0 }));

  let phase = 1;
  let period = 1;
  let pulseAmp = 0;
  let count = 0;
  let gPrev = 0;
  let amp = 0;
  let breath = 0;

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // Control values change slowly; refresh them every 32 samples.
    if ((i & 31) === 0) {
      amp = val(s.amp, t);
      breath = val(s.breath ?? 0, t);
      const F = val(s.formants, t);
      for (let j = 0; j < 5; j++) {
        const f = Math.min(F[j] * fScale, sr * 0.45);
        const r = Math.exp((-Math.PI * BANDWIDTHS[j] * bwScale) / sr);
        res[j].b = 2 * r * Math.cos((2 * Math.PI * f) / sr);
        res[j].c = -r * r;
        res[j].a = 1 - res[j].b - res[j].c;
      }
    }

    // Start of a new vocal-fold vibration: pick its length and strength,
    // each slightly different from the last, like a real voice.
    if (phase >= 1) {
      phase -= 1;
      count++;
      const rough = val(s.rough ?? 0, t);
      const odd = count & 1;
      const f0 = Math.max(20, val(s.f0 ?? 100, t) * (1 + jitter * randn()));
      // Voice cracks: alternating and chaotic vibration lengths.
      period = (sr / f0) * (1 + (odd ? 0.12 : -0.12) * rough + 0.06 * rough * randn());
      pulseAmp = amp * Math.max(0, 1 + shimmer * randn()) * (odd ? 1 - 0.75 * rough : 1);
      if (growl > 0) {
        flutterPhase += (period / sr) * rand(40, 110);
        pulseAmp *= 1 - growl * (0.5 + 0.5 * Math.sin(2 * Math.PI * flutterPhase));
      }
    }

    // Airflow through the vocal folds during one vibration.
    let g = 0;
    if (phase < tp) g = 0.5 * (1 - Math.cos((Math.PI * phase) / tp));
    else if (phase < oq) g = Math.cos(((Math.PI / 2) * (phase - tp)) / (oq - tp));
    const voiced = (g - gPrev) * period * 0.15 * pulseAmp;
    gPrev = g;
    phase += 1 / period;

    // Breath noise, puffed out in time with the vocal folds when voicing.
    const noise = (Math.random() * 2 - 1) * breath * (amp > 0.05 ? 0.35 + 0.65 * g : 1);

    // Through the mouth resonances.
    let x = voiced + noise * 0.6;
    for (let j = 0; j < 5; j++) {
      const r = res[j];
      const y = r.a * x + r.b * r.y1 + r.c * r.y2;
      r.y2 = r.y1;
      r.y1 = y;
      x = y;
    }
    out[i] = x;
  }

  // Short fades at both ends so nothing ever clicks.
  const fin = Math.min(n, Math.floor(sr * 0.003));
  const fout = Math.min(n, Math.floor(sr * 0.06));
  for (let i = 0; i < fin; i++) out[i] *= i / fin;
  for (let i = 0; i < fout; i++) out[n - 1 - i] *= i / fout;

  normalize(out);
  const drive = s.drive ?? 1;
  if (drive > 1) {
    const k = Math.tanh(drive);
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * drive) / k;
  }
  return out;
}

// ---------- general helpers ----------

export function normalize(a, peak = 1) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) {
    const g = peak / m;
    for (let i = 0; i < a.length; i++) a[i] *= g;
  }
  return a;
}

// Adds src into dst starting at `at` seconds.
export function mixInto(dst, src, sr, at = 0, gain = 1) {
  const off = Math.floor(at * sr);
  const n = Math.min(src.length, dst.length - off);
  for (let i = 0; i < n; i++) dst[i + off] += src[i] * gain;
}

// Stereo version: places a mono sound left (-1) to right (+1).
export function mixPanned(L, R, src, sr, at, gain, pan) {
  const a = ((pan + 1) * Math.PI) / 4;
  mixInto(L, src, sr, at, gain * Math.cos(a));
  mixInto(R, src, sr, at, gain * Math.sin(a));
}

export function whiteNoise(sr, dur) {
  const a = new Float32Array(Math.ceil(dur * sr));
  for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
  return a;
}

// Simple one-pole high/low-pass filters, applied in place.
export function highpass(a, sr, f) {
  const k = Math.exp((-2 * Math.PI * f) / sr);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < a.length; i++) {
    const y = k * (y1 + a[i] - x1);
    x1 = a[i];
    a[i] = y1 = y;
  }
  return a;
}

export function lowpass(a, sr, f) {
  const k = Math.exp((-2 * Math.PI * f) / sr);
  let y = 0;
  for (let i = 0; i < a.length; i++) a[i] = y = (1 - k) * a[i] + k * y;
  return a;
}

// A ringing resonance (like a wooden panel or metal bar) at f Hz.
export function resonate(input, sr, f, bw) {
  const out = new Float32Array(input.length);
  const r = Math.exp((-Math.PI * bw) / sr);
  const b = 2 * r * Math.cos((2 * Math.PI * f) / sr);
  const c = -r * r;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const y = (1 - r) * input[i] + b * y1 + c * y2;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

// Applies a loudness shape (function of time) in place.
export function shape(a, sr, fn) {
  for (let i = 0; i < a.length; i++) a[i] *= fn(i / sr);
  return a;
}

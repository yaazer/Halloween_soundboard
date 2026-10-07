// Realistic voice-based scares, built sample-by-sample with dsp.js.
// Each function takes the sample rate and returns [left, right] audio.
// Every call comes out a little different, so repeats never sound identical.

import {
  rand, pick, line, drift, vowelPath, renderVoice, normalize, mixInto, mixPanned,
  whiteNoise, highpass, lowpass, resonate, shape,
} from './dsp.js';

const withDrift = (fn, d) => (t) => fn(t) * d(t);

function stereo(sr, dur) {
  const n = Math.ceil(dur * sr);
  return [new Float32Array(n), new Float32Array(n)];
}

function finish([L, R], peak = 0.95) {
  let m = 0;
  for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  const g = m > 0 ? peak / m : 1;
  for (let i = 0; i < L.length; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return [L, R];
}

// ---------- scream ----------

function screamVoice(sr, dur, pk) {
  return renderVoice(sr, {
    dur,
    f0: withDrift(
      line([[0, pk * 0.6], [0.09, pk], [0.5, pk * 1.08], [dur - 0.6, pk * 0.95], [dur, pk * 0.5]]),
      drift(dur, 0.035, 7),
    ),
    amp: line([[0, 0], [0.03, 1], [dur - 0.5, 0.85], [dur, 0]]),
    breath: line([[0, 0.5], [0.1, 0.3], [dur - 0.4, 0.4], [dur - 0.1, 0.7], [dur, 0]]),
    formants: vowelPath([[0, 'ae'], [0.15, 'scream'], [dur - 0.3, 'scream'], [dur, 'a']]),
    fScale: 1.12,
    bwScale: 2,
    jitter: 0.03,
    shimmer: 0.22,
    rough: line([[0, 0.8], [0.25, 0.5], [dur - 0.6, 0.6], [dur, 0.9]]),
    growl: 0.55,
    oq: 0.45,
    drive: 5,
  });
}

export function scream(sr) {
  const dur = rand(2.0, 2.6);
  const out = stereo(sr, dur + 0.2);
  const pk = rand(1050, 1350);
  mixPanned(...out, screamVoice(sr, dur, pk), sr, 0, 1, rand(-0.2, 0.2));
  // A second, lower screamer a split second behind sounds far more real.
  mixPanned(...out, screamVoice(sr, dur * 0.9, pk * rand(0.72, 0.85)), sr, 0.07, 0.5, rand(-0.6, 0.6));
  return finish(out);
}

// ---------- monster roar & zombie groan ----------

export function monsterRoar(sr) {
  const dur = rand(2, 2.5);
  const base = rand(70, 85);
  const spec = {
    dur,
    f0: withDrift(
      line([[0, base * 0.9], [0.08, base * 1.55], [0.7, base * 1.35], [dur, base * 0.75]]),
      drift(dur, 0.08, 6),
    ),
    amp: line([[0, 0], [0.025, 1], [dur * 0.65, 0.9], [dur, 0]]),
    breath: line([[0, 0.6], [0.3, 0.5], [dur - 0.3, 0.9], [dur, 0]]),
    formants: vowelPath([[0, 'o'], [0.15, 'a'], [dur * 0.6, 'a'], [dur, 'o']]),
    fScale: 0.72,
    bwScale: 1.7,
    jitter: 0.05,
    shimmer: 0.3,
    rough: 0.8,
    growl: 0.6,
    oq: 0.5,
    drive: 8,
  };
  const out = stereo(sr, dur + 0.1);
  const main = renderVoice(sr, spec);
  // The same roar an octave down from a bigger throat, for size.
  const sub = renderVoice(sr, { ...spec, f0: (t) => spec.f0(t) * 0.5, fScale: 0.55 });
  mixPanned(...out, main, sr, 0, 1, -0.1);
  mixPanned(...out, sub, sr, 0, 0.85, 0.1);
  return finish(out);
}

export function zombieGroan(sr) {
  const dur = rand(2.6, 3.2);
  const groan = (pitch, len) =>
    renderVoice(sr, {
      dur: len,
      f0: withDrift(line([[0, pitch], [len * 0.5, pitch * 1.2], [len, pitch * 0.8]]), drift(len, 0.12, 3)),
      amp: line([[0, 0], [0.4, 0.9], [len * 0.6, 1], [len, 0]]),
      breath: 0.4,
      formants: vowelPath([[0, 'u'], [len * 0.3, 'uh'], [len * 0.7, 'o'], [len, 'u']]),
      fScale: 0.85,
      bwScale: 1.5,
      jitter: 0.07,
      shimmer: 0.4,
      rough: line([[0, 0.4], [len * 0.5, 0.8], [len, 0.6]]),
      growl: 0.4,
      oq: 0.55,
      drive: 4,
    });
  const out = stereo(sr, dur + 0.6);
  mixPanned(...out, groan(rand(75, 95), dur), sr, 0, 1, -0.3);
  mixPanned(...out, groan(rand(85, 110), dur * 0.85), sr, 0.45, 0.6, 0.5);
  return finish(out);
}

// ---------- laughs ----------

// Builds the "ha-ha-ha-haaa" pattern: a puff of breath, then the voice.
function laughSpec(o) {
  const amp = [[0, 0]];
  const breath = [[0, 0]];
  const f = [[0, o.f0]];
  const vw = [[0, o.vowel]];
  let st = 0.02;
  for (let i = 0; i < o.count; i++) {
    const p = o.f0 * (1 + o.pitchStep * i) * rand(0.93, 1.07);
    const syl = o.syl * rand(0.85, 1.15);
    breath.push([st, 0], [st + 0.012, 0.9], [st + 0.045, 0.25], [st + syl, 0.12], [st + syl + o.gap, 0]);
    amp.push([st + 0.022, 0], [st + 0.045, 1], [st + syl * 0.7, 0.75], [st + syl, 0], [st + syl + o.gap, 0]);
    f.push([st, p * 1.12], [st + syl, p * 0.86]);
    st += syl + o.gap;
  }
  const fl = o.finalLen;
  vw.push([st, o.vowel], [st + 0.1, o.finalVowel]);
  breath.push([st, 0], [st + 0.015, 0.9], [st + 0.06, 0.3], [st + fl, 0.45], [st + fl + 0.1, 0]);
  amp.push([st + 0.03, 0], [st + 0.07, 1], [st + fl * 0.6, 0.9], [st + fl, 0]);
  f.push([st, o.f0 * o.finalFrom], [st + fl, o.f0 * o.finalTo]);
  const dur = st + fl + 0.15;
  return {
    dur,
    amp: line(amp),
    breath: line(breath),
    f0: withDrift(line(f), drift(dur, 0.03, 8)),
    formants: vowelPath(vw),
    jitter: 0.025,
    shimmer: 0.2,
    oq: 0.5,
    ...o.voice,
  };
}

export function evilLaugh(sr) {
  const spec = laughSpec({
    f0: rand(105, 125), count: 8, syl: 0.16, gap: 0.075, pitchStep: -0.035,
    vowel: 'a', finalVowel: 'a', finalLen: 1.3, finalFrom: 1.15, finalTo: 0.5,
    voice: { fScale: 0.9, bwScale: 1.3, rough: 0.35, growl: 0.25, drive: 3 },
  });
  // A demonic double, an octave lower with a bigger "head", underneath.
  const demon = { ...spec, f0: (t) => spec.f0(t) * 0.5, fScale: 0.68, rough: 0.6, drive: 5 };
  const out = stereo(sr, spec.dur);
  mixPanned(...out, renderVoice(sr, spec), sr, 0, 1, -0.15);
  mixPanned(...out, renderVoice(sr, demon), sr, 0, 0.75, 0.15);
  return finish(out);
}

export function witchCackle(sr) {
  const spec = laughSpec({
    f0: rand(520, 620), count: 14, syl: 0.08, gap: 0.03, pitchStep: 0.02,
    vowel: 'e', finalVowel: 'i', finalLen: 0.9, finalFrom: 1.25, finalTo: 1.7,
    voice: { fScale: 1.22, bwScale: 1.5, rough: 0.5, growl: 0.3, drive: 4, jitter: 0.035, shimmer: 0.3 },
  });
  const out = stereo(sr, spec.dur);
  mixPanned(...out, renderVoice(sr, spec), sr, 0, 1, 0);
  return finish(out);
}

// ---------- ghost & wolf ----------

export function ghostWail(sr) {
  const dur = rand(3.6, 4.4);
  const b = rand(270, 330);
  const out = stereo(sr, dur + 0.3);
  [[1, -0.7, 1, 0], [1.007, 0.7, 0.8, 0.12], [1.5, 0, 0.35, 0.25]].forEach(([ratio, pan, g, delay]) => {
    const len = dur - delay;
    const v = renderVoice(sr, {
      dur: len,
      f0: withDrift(
        line([[0, b * ratio], [1.3, b * 1.75 * ratio], [2.3, b * 1.45 * ratio], [len, b * 0.8 * ratio]]),
        drift(len, 0.015, 5),
      ),
      amp: line([[0, 0], [1, 0.8], [len - 1.2, 0.7], [len, 0]]),
      breath: 0.5,
      formants: vowelPath([[0, 'u'], [1.4, 'o'], [len - 0.8, 'o'], [len, 'u']]),
      fScale: 1.15,
      jitter: 0.006,
      shimmer: 0.08,
      oq: 0.7,
    });
    mixPanned(...out, v, sr, delay, g, pan);
  });
  return finish(out);
}

function howl(sr, b, d) {
  return renderVoice(sr, {
    dur: d,
    f0: withDrift(
      line([[0, b], [0.5, b * 1.55], [d - 1.2, b * 1.68], [d - 0.35, b * 1.3], [d, b * 0.95]]),
      drift(d, 0.012, 6),
    ),
    amp: line([[0, 0], [0.25, 0.9], [d - 0.8, 0.8], [d, 0]]),
    breath: 0.15,
    formants: vowelPath([[0, 'u'], [0.5, 'o'], [d - 0.8, 'o'], [d, 'u']]),
    fScale: 1.35,
    bwScale: 1.1,
    jitter: 0.007,
    shimmer: 0.06,
    rough: line([[0, 0.35], [0.3, 0], [d, 0]]),
    oq: 0.55,
    drive: 1.5,
  });
}

export function wolfHowl(sr) {
  const d1 = rand(3.4, 4);
  const d2 = rand(3, 3.6);
  const out = stereo(sr, 1.3 + d2 + 0.2);
  mixPanned(...out, howl(sr, rand(380, 420), d1), sr, 0, 1, -0.4);
  // A second wolf from the pack answers.
  mixPanned(...out, howl(sr, rand(430, 470), d2), sr, 1.3, 0.55, 0.6);
  return finish(out);
}

// ---------- whispers & breathing ----------

function whisperer(sr, dur) {
  const br = [[0, 0]];
  const vw = [[0, 'e']];
  const consonants = [];
  let t = 0.05;
  while (t < dur - 0.7) {
    const c = pick(['s', 's', 'sh', 'h', 'k', 't']);
    const cl = c === 's' || c === 'sh' ? rand(0.1, 0.2) : c === 'h' ? 0.08 : 0.025;
    consonants.push([t, c, cl]);
    t += cl;
    const v = pick(['a', 'e', 'i', 'o', 'u', 'uh']);
    const vl = rand(0.12, 0.25);
    br.push([t, 0], [t + 0.03, rand(0.6, 1)], [t + vl - 0.04, 0.5], [t + vl, 0]);
    vw.push([t, v], [t + vl, v]);
    t += vl + (Math.random() < 0.25 ? rand(0.15, 0.35) : rand(0, 0.05));
  }
  consonants.push([t, 's', Math.max(0.3, dur - t - 0.05)]); // trailing "sssss"

  const out = renderVoice(sr, {
    dur, amp: 0, breath: line(br), formants: vowelPath(vw), fScale: 1.05, bwScale: 1.4,
  });
  normalize(out, 0.8);
  for (const [at, c, len] of consonants) {
    const n = whiteNoise(sr, len);
    let g = 0.35;
    if (c === 's') { highpass(highpass(n, sr, 4500), sr, 4500); g = 0.9; }
    else if (c === 'sh') { normalize(resonate(n, sr, 2600, 1400)).forEach((v, i) => { n[i] = v; }); g = 0.5; }
    else if (c === 'h') { lowpass(n, sr, 2500); g = 0.25; }
    else { highpass(n, sr, 1500); g = 0.6; }
    shape(n, sr, (x) => Math.min(1, x / 0.015) * Math.min(1, (len - x) / 0.03));
    mixInto(out, n, sr, at, g);
  }
  return out;
}

export function whisper(sr) {
  const dur = rand(3, 3.6);
  const out = stereo(sr, dur + 0.9);
  // Several voices whispering from different sides.
  mixPanned(...out, whisperer(sr, dur), sr, 0, 1, -0.85);
  mixPanned(...out, whisperer(sr, dur - 0.3), sr, 0.4, 0.8, 0.85);
  mixPanned(...out, whisperer(sr, dur - 0.5), sr, 0.85, 0.5, 0);
  return finish(out);
}

export function heavyBreathing(sr) {
  const inhale = (len) =>
    renderVoice(sr, {
      dur: len, amp: 0,
      breath: line([[0, 0], [len * 0.65, 1], [len * 0.9, 0.6], [len, 0]]),
      formants: vowelPath([[0, 'o'], [len, 'u']]), fScale: 0.95, bwScale: 2,
    });
  const exhale = (len) =>
    renderVoice(sr, {
      dur: len,
      amp: line([[0, 0], [0.2, 0.3], [len * 0.7, 0.18], [len, 0]]),
      f0: line([[0, rand(90, 105)], [len, 70]]),
      breath: line([[0, 0], [0.08, 1], [len * 0.6, 0.6], [len, 0]]),
      formants: vowelPath([[0, 'uh'], [len, 'a']]),
      fScale: 0.85, bwScale: 1.8, rough: 0.6, jitter: 0.07, shimmer: 0.4, drive: 2,
    });
  const out = stereo(sr, 5.4);
  let t = 0;
  for (let k = 0; k < 2; k++) {
    const il = rand(0.9, 1.2);
    const el = rand(1.1, 1.4);
    mixPanned(...out, inhale(il), sr, t, 0.8, 0);
    mixPanned(...out, exhale(el), sr, t + il + 0.05, 1, 0);
    t += il + el + rand(0.15, 0.3);
  }
  return finish(out);
}

// ---------- creaky door ----------

export function creakyDoor(sr) {
  const dur = rand(2.2, 3);
  const n = Math.ceil(dur * sr);
  const clicks = new Float32Array(n);
  // Stick-slip friction: irregular little "catches" that speed up and slow down.
  const rate = withDrift(line([[0, 14], [dur * 0.3, rand(40, 70)], [dur * 0.7, rand(25, 50)], [dur, 12]]), drift(dur, 0.25, 5));
  const loud = line([[0, 0.3], [0.2, 1], [dur * 0.8, 0.8], [dur, 0]]);
  let t = 0;
  while (t < dur) {
    const i = Math.floor(t * sr);
    clicks[i] = loud(t) * rand(0.5, 1);
    if (i + 1 < n) clicks[i + 1] = -clicks[i] * 0.5;
    t += (1 / rate(t)) * rand(0.85, 1.15);
  }
  // Wooden door panel resonances.
  const out = new Float32Array(n);
  [[rand(380, 460), 25, 1], [rand(700, 820), 30, 0.8], [rand(1150, 1300), 40, 0.6], [rand(1800, 2050), 50, 0.4], [rand(2700, 3000), 60, 0.25]]
    .forEach(([f, bw, g]) => mixInto(out, normalize(resonate(clicks, sr, f, bw)), sr, 0, g));
  const res = stereo(sr, dur);
  mixPanned(...res, out, sr, 0, 1, rand(-0.5, 0.5));
  return finish(res);
}

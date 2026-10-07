const $ = (id) => document.getElementById(id);

// ---------- settings (remembered on this phone) ----------

const DEFAULTS = { master: 0.85, drone: 0.6, scare: 1, duck: true, autoMin: 20, autoMax: 60 };
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('spookboard') || '{}') };
} catch { /* storage unavailable: use defaults */ }
function saveSettings() {
  try { localStorage.setItem('spookboard', JSON.stringify(settings)); } catch { /* ignore */ }
}

// ---------- your own sounds, stored in IndexedDB ----------

const db = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('spookboard', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async run(mode, fn) {
    const conn = await this.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction('sounds', mode);
      const req = fn(tx.objectStore('sounds'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  all() { return this.run('readonly', (s) => s.getAll()); },
  put(rec) { return this.run('readwrite', (s) => s.put(rec)); },
  del(id) { return this.run('readwrite', (s) => s.delete(id)); },
};

// ---------- audio engine ----------

let ac = null;
let master;
const buses = {}; // { drone: {...}, scare: {...} }
const liveScares = new Set();
const liveDrones = new Map(); // tile id -> { stop() }
let customs = []; // { id, name, kind, blob, buffer }

function makeBus(volume) {
  // input -> volume -> duck -> master
  const vol = ac.createGain();
  vol.gain.value = volume;
  const duck = ac.createGain();
  vol.connect(duck).connect(master);
  return { input: vol, vol, duck };
}

function initAudio() {
  if (ac) return;
  // iOS: play even when the ringer/silent switch is on.
  if (navigator.audioSession) {
    try { navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  ac = new Ctx({ latencyHint: 'interactive' });

  // A limiter so stacking lots of sounds never distorts the speaker.
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ac.destination);
  master = ac.createGain();
  master.gain.value = settings.master;
  master.connect(limiter);

  buses.drone = makeBus(settings.drone);
  buses.scare = makeBus(settings.scare);

  // Play a silent blip: this "unlocks" audio on iPhones.
  const blip = ac.createBufferSource();
  blip.buffer = ac.createBuffer(1, 1, ac.sampleRate);
  blip.connect(ac.destination);
  blip.start();

  // Bring audio back if the phone paused it (e.g. after a phone call).
  document.addEventListener('pointerdown', () => {
    if (ac.state !== 'running') ac.resume();
  }, { capture: true });

  customs.forEach(decodeCustom);
}

function resumeAudio() {
  if (ac && ac.state !== 'running') ac.resume();
}

// ---------- ducking: drones dip while a scare plays ----------

let duckUntil = 0;
function duckDrones(seconds) {
  if (!settings.duck || !ac) return;
  const now = ac.currentTime;
  const g = buses.drone.duck.gain;
  duckUntil = Math.max(duckUntil, now + seconds);
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0.35, now + 0.08);
  g.setValueAtTime(0.35, duckUntil);
  g.linearRampToValueAtTime(1, duckUntil + 1.2);
}

// ---------- playing things ----------

function playScare(item, tile) {
  initAudio();
  resumeAudio();
  if (!item.buffer) return toast('That sound is still loading…');
  // Each scare gets its own volume control so "Stop all" can silence it instantly.
  const voice = ac.createGain();
  voice.connect(buses.scare.input);
  const src = ac.createBufferSource();
  src.buffer = item.buffer;
  src.connect(voice);
  src.start();
  const length = item.buffer.duration;
  liveScares.add(voice);
  setTimeout(() => {
    liveScares.delete(voice);
    voice.disconnect();
  }, (length + 1) * 1000);
  duckDrones(length);

  if (tile) {
    tile.classList.add('firing');
    clearTimeout(tile._t);
    tile._t = setTimeout(() => tile.classList.remove('firing'), Math.max(300, length * 1000));
  }
}

function startDrone(item) {
  initAudio();
  resumeAudio();
  if (!item.buffer) {
    toast('That sound is still loading…');
    return null;
  }
  // Fade in, loop forever, fade out on stop.
  const g = ac.createGain();
  g.gain.setValueAtTime(0, ac.currentTime);
  g.gain.linearRampToValueAtTime(1, ac.currentTime + 2);
  g.connect(buses.drone.input);
  const src = ac.createBufferSource();
  src.buffer = item.buffer;
  src.loop = true;
  src.connect(g);
  src.start();
  return {
    stop() {
      const now = ac.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 1.5);
      src.stop(now + 1.6);
    },
  };
}

function toggleDrone(item, tile) {
  if (liveDrones.has(item.id)) {
    liveDrones.get(item.id).stop();
    liveDrones.delete(item.id);
    tile.classList.remove('on');
  } else {
    const d = startDrone(item);
    if (!d) return;
    liveDrones.set(item.id, d);
    tile.classList.add('on');
  }
}

function stopAll() {
  for (const d of liveDrones.values()) d.stop();
  liveDrones.clear();
  document.querySelectorAll('.tile.on').forEach((t) => t.classList.remove('on'));
  if (ac) {
    const now = ac.currentTime;
    for (const g of liveScares) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 0.1);
    }
    liveScares.clear();
  }
  document.querySelectorAll('.tile.firing').forEach((t) => t.classList.remove('firing'));
  setAuto(false);
}

// ---------- building the tiles ----------

function makeTile(item, kind) {
  const b = document.createElement('button');
  b.className = 'tile' + (item.buffer ? '' : ' missing');
  b.innerHTML = `<span class="emoji"></span><span class="name"></span>`;
  b.querySelector('.emoji').textContent = kind === 'scare' ? '🔊' : '🔁';
  b.querySelector('.name').textContent = item.name;
  if (liveDrones.has(item.id)) b.classList.add('on');

  if (kind === 'scare') {
    // Fire on finger-down rather than release: every millisecond counts.
    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (handleEdit(item)) return;
      playScare(item, b);
    });
  } else {
    b.addEventListener('click', () => {
      if (handleEdit(item)) return;
      toggleDrone(item, b);
    });
  }
  return b;
}

// The "+ Add" tile at the end of each section opens the phone's file picker.
function makeAddTile(kind) {
  const b = document.createElement('button');
  b.className = 'tile add';
  b.innerHTML = `<span class="emoji">＋</span><span class="name"></span>`;
  b.querySelector('.name').textContent = kind === 'scare' ? 'Add scares' : 'Add drones';
  b.addEventListener('click', () => {
    if (!editing) $(kind === 'scare' ? 'addScare' : 'addDrone').click();
  });
  return b;
}

function render() {
  for (const kind of ['drone', 'scare']) {
    $(kind + 's').replaceChildren(
      ...customs.filter((c) => c.kind === kind).map((c) => makeTile(c, kind)),
      makeAddTile(kind),
    );
  }
}

// ---------- custom sounds ----------

async function decodeCustom(rec) {
  if (rec.buffer || !ac) return;
  try {
    const data = await rec.blob.arrayBuffer();
    rec.buffer = await new Promise((resolve, reject) => ac.decodeAudioData(data, resolve, reject));
  } catch {
    toast(`Couldn't read "${rec.name}" — try an MP3 or WAV file.`);
  }
  render();
}

async function addFiles(files, kind) {
  let added = 0;
  for (const file of files) {
    const rec = {
      id: 'c' + Date.now() + Math.random().toString(36).slice(2, 7),
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 24),
      kind,
      blob: file,
    };
    try {
      await db.put({ id: rec.id, name: rec.name, kind, blob: file });
    } catch {
      toast('Could not save the sound on this phone (storage full or private mode?).');
    }
    customs.push(rec);
    decodeCustom(rec);
    added++;
  }
  render();
  if (added) toast(`Added ${added} sound${added > 1 ? 's' : ''}`);
}

let editing = false;
function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $('editHint').hidden = !on;
}

// In edit mode, tapping one of your own sounds offers to delete it.
function handleEdit(item) {
  if (!editing) return false;
  if (confirm(`Delete "${item.name}"?`)) {
    if (liveDrones.has(item.id)) {
      liveDrones.get(item.id).stop();
      liveDrones.delete(item.id);
    }
    customs = customs.filter((c) => c.id !== item.id);
    db.del(item.id).catch(() => {});
    render();
  }
  return true;
}

// ---------- auto-spook ----------

let autoTimer = null;
let autoAt = 0;
let autoTick = null;

function randomScare() {
  const scares = customs.filter((c) => c.kind === 'scare');
  const ready = scares.filter((c) => c.buffer);
  if (!ready.length) return toast('Add some scare sounds first.');
  const item = ready[Math.floor(Math.random() * ready.length)];
  playScare(item, $('scares').children[scares.indexOf(item)]);
}

function scheduleAuto() {
  const lo = Math.max(3, Number(settings.autoMin) || 20);
  const hi = Math.max(lo, Number(settings.autoMax) || 60);
  const wait = (lo + Math.random() * (hi - lo)) * 1000;
  autoAt = Date.now() + wait;
  autoTimer = setTimeout(() => {
    randomScare();
    scheduleAuto();
  }, wait);
}

function setAuto(on) {
  clearTimeout(autoTimer);
  clearInterval(autoTick);
  autoTimer = null;
  $('auto').setAttribute('aria-pressed', String(on));
  $('autoStatus').textContent = 'off';
  if (!on) return;
  if (!customs.some((c) => c.kind === 'scare')) {
    $('auto').setAttribute('aria-pressed', 'false');
    toast('Add some scare sounds first.');
    return;
  }
  initAudio();
  scheduleAuto();
  const update = () => {
    $('autoStatus').textContent = `next in ${Math.max(0, Math.round((autoAt - Date.now()) / 1000))}s`;
  };
  update();
  autoTick = setInterval(update, 1000);
}

// ---------- keep the screen awake ----------

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not supported or denied: fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock !== null) keepAwake();
});

// ---------- misc UI ----------

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

function bindSlider(id, key, apply) {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('input', () => {
    settings[key] = Number(el.value);
    saveSettings();
    if (ac) apply(Number(el.value));
  });
}

function setup() {
  bindSlider('volMaster', 'master', (v) => master.gain.setTargetAtTime(v, ac.currentTime, 0.05));
  bindSlider('volDrone', 'drone', (v) => buses.drone.vol.gain.setTargetAtTime(v, ac.currentTime, 0.05));
  bindSlider('volScare', 'scare', (v) => buses.scare.vol.gain.setTargetAtTime(v, ac.currentTime, 0.05));

  $('startBtn').addEventListener('click', () => {
    initAudio();
    keepAwake();
    $('start').classList.add('hidden');
  });

  $('stopAll').addEventListener('click', stopAll);
  $('random').addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    randomScare();
  });
  $('auto').addEventListener('click', () => setAuto(!autoTimer));

  const dlg = $('settings');
  $('settingsBtn').addEventListener('click', () => {
    $('duck').checked = settings.duck;
    $('autoMin').value = settings.autoMin;
    $('autoMax').value = settings.autoMax;
    dlg.showModal();
  });
  $('duck').addEventListener('change', (ev) => { settings.duck = ev.target.checked; saveSettings(); });
  for (const k of ['autoMin', 'autoMax']) {
    $(k).addEventListener('change', (ev) => { settings[k] = Number(ev.target.value); saveSettings(); });
  }
  for (const [id, kind] of [['addScare', 'scare'], ['addDrone', 'drone']]) {
    $(id).addEventListener('change', (ev) => {
      addFiles([...ev.target.files], kind);
      ev.target.value = '';
      dlg.close();
    });
  }
  $('editMode').addEventListener('click', () => {
    setEditing(!editing);
    dlg.close();
    if (editing && !customs.length) {
      toast("You haven't added any sounds yet.");
      setEditing(false);
    }
  });
  dlg.addEventListener('close', () => { if (autoTimer) setAuto(true); });

  render();
  db.all()
    .then((recs) => {
      customs = recs || [];
      customs.forEach(decodeCustom);
      render();
    })
    .catch(() => toast("This browser can't save sounds (private mode?)."));

  // Leave edit mode with a tap on the hint.
  $('editHint').addEventListener('click', () => setEditing(false));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

setup();

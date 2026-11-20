// Settings and developer tools for the Bloons TD 5 demo (Scratch VM / TurboWarp runtime).
// Exposes a floating panel (gear icon, top-right) and an FPS/clone overlay.
// Settings persist to localStorage and are applied at startup so changes survive refreshes.
//
// This runs after script.js has created `window.vm` / `window.scaffolding`.
// It also exposes `window.__btd5Settings` so the inline bootstrap in index.html
// can read graphics/FPS choices before the project starts.

(function () {
  'use strict';

  const DEFAULTS = {
    // Graphics
    quality: 'low',          // 'low' | 'normal' | 'high'
    maxTexture: 1024,        // 512 | 1024 | 2048
    interpolation: true,
    // Performance
    targetFps: 30,           // 15 | 20 | 30 | 60 | 120 | 150 | 300 | 450 | 600
    turbo: false,
    // In-game fast forward: overrides the game's own `Fast Forward?` variable.
    // 0 = don't override (the in-game 1x/2x button works normally).
    inGameSpeed: 0,
    // Developer
    overlay: false,
    infiniteMoney: false,
    godMode: false,
    // Modifier modes (BTD6-inspired, implemented as watchdogs on `money` / `lives`)
    halfCash: false,
    doubleCash: false,
    chimpsLite: false,         // reload on any life lost
    // Co-op
    passPlayEnabled: false,
    passPlayTurnSec: 60,
  };
  const LS_KEY = 'btd5_dt_settings';

  function read() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }
  function write(settings) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  const settings = read();
  const listeners = new Set();
  function setSetting(key, value) {
    settings[key] = value;
    write(settings);
    apply();
    for (const fn of listeners) { try { fn(key, value); } catch (e) {} }
  }

  // --- Runtime application ---------------------------------------------------
  function apply() {
    const vm = window.vm;
    if (!vm) return;
    try {
      if (vm.renderer && vm.renderer.setUseHighQualityRender) {
        vm.renderer.setUseHighQualityRender(settings.quality === 'high');
      }
      if (vm.renderer && vm.renderer.setMaxTextureDimension) {
        vm.renderer.setMaxTextureDimension(settings.maxTexture);
      }
      if (vm.setInterpolation) vm.setInterpolation(!!settings.interpolation);
      if (vm.setFramerate) vm.setFramerate(settings.targetFps);
      // At 5x and above the browser can't rAF that fast — turbo keeps the sim loop stepping
      if (vm.setTurboMode) vm.setTurboMode(!!settings.turbo || settings.targetFps >= 150);
    } catch (e) {
      console.warn('[devtools] apply failed:', e);
    }
  }

  // Expose settings to the inline bootstrap so it reads the same values at startup.
  window.__btd5Settings = {
    get: () => ({ ...settings }),
    getSetting: (k) => settings[k],
    setSetting,
    apply,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };

  // --- Wait for runtime, then build UI --------------------------------------
  function onReady(fn) {
    if (window.vm && window.scaffolding) return fn();
    let tries = 0;
    const t = setInterval(() => {
      if (window.vm && window.scaffolding) { clearInterval(t); fn(); return; }
      if (++tries > 600) clearInterval(t); // give up after ~60 s
    }, 100);
  }

  function findStageVar(name) {
    const stage = window.vm && window.vm.runtime && window.vm.runtime.getTargetForStage();
    if (!stage) return null;
    for (const id in stage.variables) {
      if (stage.variables[id].name === name) return stage.variables[id];
    }
    return null;
  }
  function setStageVar(name, value) {
    const v = findStageVar(name);
    if (v) v.value = value;
    return v;
  }

  // --- Panel UI --------------------------------------------------------------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'onclick' || k === 'onchange' || k === 'oninput') el[k] = props[k];
        else if (k === 'style') Object.assign(el.style, props[k]);
        else if (k in el) el[k] = props[k];
        else el.setAttribute(k, props[k]);
      }
    }
    for (const c of children) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function row(labelText, control, hint) {
    const inner = h('div', null,
      h('div', null, labelText, hint ? h('small', null, hint) : null)
    );
    return h('div', { className: 'dt-row' }, inner, control);
  }

  function makeSelect(key, options) {
    const sel = h('select');
    for (const [v, l] of options) {
      const opt = h('option', { value: String(v) }, l);
      if (String(settings[key]) === String(v)) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      let v = sel.value;
      if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      setSetting(key, v);
    };
    return sel;
  }

  function makeToggle(key) {
    const btn = h('button', { type: 'button' }, settings[key] ? 'On' : 'Off');
    if (settings[key]) btn.classList.add('dt-toggle-on');
    btn.onclick = () => {
      const next = !settings[key];
      setSetting(key, next);
      btn.textContent = next ? 'On' : 'Off';
      btn.classList.toggle('dt-toggle-on', next);
    };
    return btn;
  }

  function makeCheat(label, varName, initial) {
    const inp = h('input', { type: 'number', value: String(initial) });
    const btn = h('button', { className: 'dt-apply', type: 'button' }, 'Set');
    btn.onclick = () => {
      const n = Number(inp.value);
      if (Number.isFinite(n)) {
        setStageVar(varName, n);
        btn.textContent = '✓';
        setTimeout(() => (btn.textContent = 'Set'), 800);
      }
    };
    return h('div', { className: 'dt-row' }, h('div', null, label, h('small', null, `var: ${varName}`)), h('div', { style: { display: 'flex', gap: '6px' } }, inp, btn));
  }

  // Watchdogs for infinite-money / god-mode / modifier modes
  let watchdogTimer = null;
  let lastMoney = null;
  let lastLives = null;
  function startWatchdogs() {
    if (watchdogTimer) return;
    const m = findStageVar('money'); if (m) lastMoney = Number(m.value);
    const l = findStageVar('lives'); if (l) lastLives = Number(l.value);
    watchdogTimer = setInterval(() => {
      // Money modifiers: react to increases only
      const mv = findStageVar('money');
      if (mv) {
        const cur = Number(mv.value);
        if (lastMoney != null && cur > lastMoney) {
          const gain = cur - lastMoney;
          if (settings.halfCash && !settings.infiniteMoney) {
            mv.value = lastMoney + Math.max(0, Math.floor(gain / 2));
          } else if (settings.doubleCash && !settings.infiniteMoney) {
            mv.value = lastMoney + gain * 2;
          }
        }
        if (settings.infiniteMoney && Number(mv.value) < 99000) mv.value = 999999;
        lastMoney = Number(mv.value);
      }
      // In-game fast forward override: peg the game's `Fast Forward?` variable
      if (settings.inGameSpeed > 0) {
        const ff = findStageVar('Fast Forward?');
        if (ff && Number(ff.value) !== settings.inGameSpeed) ff.value = settings.inGameSpeed;
      }
      // Lives
      const lv = findStageVar('lives');
      if (lv) {
        const cur = Number(lv.value);
        if (settings.godMode && cur < 500) { lv.value = 999; lastLives = 999; }
        else if (settings.chimpsLite && lastLives != null && cur < lastLives) {
          // Lost a life under CHIMPS-lite: show a failure banner and disable the
          // mode. The game keeps going so the player can see where they stood.
          const rv = findStageVar('round');
          showChimpsFailure(Number(rv && rv.value) || 0, lastLives - cur);
          setSetting('chimpsLite', false);
          lastLives = cur;
        } else {
          lastLives = cur;
        }
      }
    }, 150); // 6-7 Hz: fast enough to catch money changes before the game draws them next
  }
  function stopWatchdogsIfIdle() {
    if (settings.infiniteMoney || settings.godMode || settings.halfCash
        || settings.doubleCash || settings.chimpsLite || settings.inGameSpeed > 0) return;
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }

  // Make the money modifiers mutually exclusive in the UI
  function enforceExclusive(k) {
    const groups = { cash: ['halfCash', 'doubleCash'] };
    for (const group of Object.values(groups)) {
      if (group.includes(k)) {
        for (const other of group) if (other !== k && settings[other]) setSetting(other, false);
      }
    }
  }

  // --- CHIMPS failure banner (non-destructive replacement for auto-restart) --
  let chimpsFailEl = null;
  function showChimpsFailure(round, lost) {
    if (chimpsFailEl) chimpsFailEl.remove();
    chimpsFailEl = h('div', { id: 'dt-chimps-fail' },
      h('strong', null, 'CHIMPS FAILED'),
      h('div', { className: 'dt-sub', style: { color: '#fecaca', margin: '2px 0 6px' } },
        `Lost ${lost} life${lost === 1 ? '' : 's'}${round > 0 ? ' on round ' + round : ''}. CHIMPS lite turned off.`),
      h('button', { type: 'button' }, 'Dismiss')
    );
    chimpsFailEl.querySelector('button').onclick = () => {
      if (chimpsFailEl) { chimpsFailEl.remove(); chimpsFailEl = null; }
    };
    document.body.appendChild(chimpsFailEl);
    setTimeout(() => {
      if (chimpsFailEl) { chimpsFailEl.remove(); chimpsFailEl = null; }
    }, 7000);
  }

  // --- Game modes & co-op helpers -------------------------------------------
  function broadcast(name) {
    try {
      const vm = window.vm; if (!vm || !vm.runtime) return;
      vm.runtime.startHats('event_whenbroadcastreceived', { BROADCAST_OPTION: name });
    } catch (e) { console.warn('[devtools] broadcast', name, e); }
  }

  // Pass & Play state (same-device turn-based)
  let ppTimer = null;
  let ppEndsAt = 0;
  let ppTurn = 1;
  let ppBadge = null;
  function passPlayEnsureBadge() {
    if (ppBadge) return ppBadge;
    ppBadge = h('div', { id: 'dt-pp-badge' });
    Object.assign(ppBadge.style, {
      position: 'fixed', bottom: 'calc(16px + env(safe-area-inset-bottom))',
      left: '50%', transform: 'translateX(-50%)', zIndex: 60,
      padding: '8px 16px', borderRadius: '999px',
      background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.3)',
      color: '#fff', font: '13px system-ui', pointerEvents: 'auto', cursor: 'pointer',
    });
    ppBadge.onclick = () => {
      // Click badge to skip/pass immediately
      ppEndsAt = Date.now();
    };
    document.body.appendChild(ppBadge);
    return ppBadge;
  }
  function passPlayStop() {
    if (ppTimer) { clearInterval(ppTimer); ppTimer = null; }
    if (ppBadge) { ppBadge.remove(); ppBadge = null; }
    try { if (window.vm && window.vm.setPaused) window.vm.setPaused(false); } catch (e) {}
  }
  function passPlayStart() {
    passPlayStop();
    ppTurn = 1;
    const beginTurn = () => {
      ppEndsAt = Date.now() + Math.max(10, settings.passPlayTurnSec) * 1000;
      try { if (window.vm && window.vm.setPaused) window.vm.setPaused(false); } catch (e) {}
    };
    beginTurn();
    passPlayEnsureBadge();
    ppTimer = setInterval(() => {
      if (!settings.passPlayEnabled) { passPlayStop(); return; }
      const remain = Math.max(0, Math.ceil((ppEndsAt - Date.now()) / 1000));
      ppBadge.textContent = `P${ppTurn}'s turn — ${remain}s (tap to pass)`;
      if (remain === 0) {
        try { if (window.vm && window.vm.setPaused) window.vm.setPaused(true); } catch (e) {}
        const next = ppTurn === 1 ? 2 : 1;
        ppBadge.textContent = `Pass to P${next} — tap to begin`;
        ppBadge.onclick = () => {
          ppTurn = next;
          ppBadge.onclick = () => { ppEndsAt = Date.now(); };
          beginTurn();
        };
      }
    }, 250);
  }

  // --- BTD6 Map Reference ----------------------------------------------------
  // Data is bundled at ./btd6_maps.json, produced by scripts/fetch_btd6_maps.py.
  let btd6MapCache = null;
  async function loadBtd6Maps() {
    if (btd6MapCache !== null) return btd6MapCache;
    try {
      const r = await fetch('./btd6_maps.json');
      if (!r.ok) throw new Error(String(r.status));
      btd6MapCache = await r.json();
    } catch (e) {
      btd6MapCache = { error: String(e) };
    }
    return btd6MapCache;
  }
  function primaryDifficulty(m) {
    if (!m || !m.difficulty) return 'Unknown';
    if (typeof m.difficulty === 'string') return m.difficulty;
    // conflict: pick the first-seen source's reading as the primary
    const vals = Object.values(m.difficulty).filter(Boolean);
    return vals[0] || 'Unknown';
  }
  let challengeEl = null;
  function showChallenge(map) {
    if (challengeEl) challengeEl.remove();
    const diff = primaryDifficulty(map);
    const extra = map.extra || {};
    const sbExtra = extra.superbot || {};
    challengeEl = h('div', { id: 'dt-challenge' },
      h('span', { className: 'dt-badge dt-diff-' + diff.toLowerCase() }, diff),
      h('span', null, 'Challenge: ' + map.name),
      sbExtra.has_water ? h('span', { className: 'dt-map-meta' }, '· water') : null,
      h('button', { type: 'button', title: 'dismiss' }, '×'),
    );
    challengeEl.querySelector('button').onclick = () => { challengeEl.remove(); challengeEl = null; };
    document.body.appendChild(challengeEl);
  }

  // --- Auto-save / restore --------------------------------------------------
  // Rapid taps can accidentally hit the green-flag or stop-all buttons overlaid
  // on the game, which restarts the Scratch project and wipes in-game progress.
  // Guard those calls with a confirmation when a round is in progress, and keep
  // a localStorage snapshot of the key stage variables so even an actual page
  // reload (e.g. Safari discarding the tab under memory pressure) is recoverable.
  const AUTOSAVE_KEY = 'btd5_autosave_v1';
  const SAVED_VARS = [
    'money', 'lives', 'round', 'wave', 'gametime',
    'Fast Forward?', 'Former Fast Forward',
    'longestTime', '☁ mostwaves', '☁ Global Pops',
  ];

  function readStageVars() {
    const stage = window.vm && window.vm.runtime.getTargetForStage();
    if (!stage) return {};
    const out = {};
    for (const id in stage.variables) {
      const v = stage.variables[id];
      if (SAVED_VARS.includes(v.name)) out[v.name] = v.value;
    }
    return out;
  }
  function writeStageVars(vars) {
    const stage = window.vm && window.vm.runtime.getTargetForStage();
    if (!stage) return 0;
    let n = 0;
    for (const id in stage.variables) {
      const v = stage.variables[id];
      if (Object.prototype.hasOwnProperty.call(vars, v.name)) {
        v.value = vars[v.name];
        n++;
      }
    }
    return n;
  }
  function saveSnapshot(reason) {
    try {
      const vars = readStageVars();
      // Only save if we're actually in a game (round > 0 or wave > 0)
      if (!(Number(vars.round) > 0 || Number(vars.wave) > 0)) return;
      localStorage.setItem(AUTOSAVE_KEY,
        JSON.stringify({ t: Date.now(), reason: reason || 'tick', vars }));
    } catch (e) {}
  }
  function loadSnapshot() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.vars) return null;
      if (Date.now() - (s.t || 0) > 24 * 3600 * 1000) return null;
      return s;
    } catch (e) { return null; }
  }

  // --- Statistics tracker ----------------------------------------------------
  // Counts games played (round 0 -> 1 transition only, so cheats don't inflate it),
  // highest round / wave ever reached, and total time with the game running.
  const STATS_KEY = 'btd5_stats_v1';
  const DEFAULT_STATS = {
    gamesPlayed: 0,
    highestRound: 0,
    highestWave: 0,
    totalTimePlayed: 0, // seconds
    lastPlayedAt: null,
  };
  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return { ...DEFAULT_STATS };
      return { ...DEFAULT_STATS, ...(JSON.parse(raw) || {}) };
    } catch (e) {
      return { ...DEFAULT_STATS };
    }
  }
  function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function resetStats() {
    try { localStorage.removeItem(STATS_KEY); } catch (e) {}
  }

  // Combined tick: autosave + stats bookkeeping. Runs every 5 s.
  let autosaveTimer = null;
  let lastTickAt = Date.now();
  let lastTickRound = 0;
  let gameRunning = false;
  function autoTick() {
    const now = Date.now();
    const dt = Math.min(10, (now - lastTickAt) / 1000); // clamp for sleep/background gaps
    lastTickAt = now;
    const vars = readStageVars();
    const round = Number(vars.round) || 0;
    const wave = Number(vars.wave) || 0;
    const lives = Number(vars.lives) || 0;
    // Snapshot
    if (round > 0 || wave > 0) {
      try {
        localStorage.setItem(AUTOSAVE_KEY,
          JSON.stringify({ t: now, reason: 'tick', vars }));
      } catch (e) {}
    }
    // Stats transitions
    const stats = loadStats();
    const pergame = loadPerGame();
    // A real game-start: round went from 0 to 1 (ignores cheat-set rounds).
    if (lastTickRound === 0 && round === 1 && !gameRunning) {
      gameRunning = true;
      stats.gamesPlayed += 1;
      stats.lastPlayedAt = now;
      pergame.startingLives = lives;
      pergame.livesLost = 0;
      pergame.lastLives = lives;
      savePerGame(pergame);
    }
    // Game end: round rolled back to 0, or lives hit 0.
    if (gameRunning && (round === 0 || lives === 0)) {
      gameRunning = false;
    }
    if (gameRunning) {
      stats.totalTimePlayed += dt;
      if (round > stats.highestRound) stats.highestRound = round;
      if (wave > stats.highestWave) stats.highestWave = wave;
      // Per-game: track lives lost this run
      if (typeof pergame.lastLives === 'number' && lives < pergame.lastLives) {
        pergame.livesLost = (pergame.livesLost || 0) + (pergame.lastLives - lives);
      }
      pergame.lastLives = lives;
      savePerGame(pergame);
    }
    saveStats(stats);
    checkAchievements({ vars, stats, pergame, now });
    lastTickRound = round;
  }
  function startAutosave() {
    if (autosaveTimer) return;
    lastTickAt = Date.now();
    lastTickRound = 0;
    gameRunning = false;
    autosaveTimer = setInterval(autoTick, 5000);
  }

  // --- Achievements ----------------------------------------------------------
  // Unlocked achievements are stored as { id: timestamp }. Checks run in the
  // same autoTick() pass as stats, so there's no extra polling.
  const ACH_KEY = 'btd5_achievements_v1';
  const PERGAME_KEY = 'btd5_pergame_v1'; // transient per-game bookkeeping
  const ACHIEVEMENTS = [
    { id: 'first_game',    name: 'Here We Go',         desc: 'Start your first game.' },
    { id: 'round_25',      name: 'Getting Warm',       desc: 'Reach round 25.' },
    { id: 'round_40',      name: 'Impressive',         desc: 'Reach round 40.' },
    { id: 'round_50',      name: 'Beat the Demo',      desc: 'Reach round 50.' },
    { id: 'round_75',      name: 'Overachiever',       desc: 'Reach round 75.' },
    { id: 'round_100',     name: 'Centennial',         desc: 'Reach round 100.' },
    { id: 'games_10',      name: 'Dedicated',          desc: 'Play 10 games.' },
    { id: 'time_1hr',      name: 'An Hour Well Spent', desc: 'Play for 1 hour total.' },
    { id: 'time_10hr',     name: 'Super Fan',          desc: 'Play for 10 hours total.' },
    { id: 'no_hit_50',     name: 'Flawless',           desc: 'Beat round 50 without losing any lives.' },
    { id: 'high_roller',   name: 'High Roller',        desc: 'Hold $100,000 at once.' },
    { id: 'cheat_lord',    name: 'Cheat Lord',         desc: 'Enable Infinite Money and God Mode together.' },
    { id: 'cotd_done',     name: 'Daily Dose',         desc: 'Complete a Challenge of the Day.' },
    { id: 'cotd_streak_7', name: 'Streak Keeper',      desc: 'Complete the Daily for 7 days in a row.' },
  ];
  function loadAchievements() {
    try { return JSON.parse(localStorage.getItem(ACH_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveAchievements(a) {
    try { localStorage.setItem(ACH_KEY, JSON.stringify(a)); } catch (e) {}
  }
  function loadPerGame() {
    try { return JSON.parse(localStorage.getItem(PERGAME_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePerGame(d) {
    try { localStorage.setItem(PERGAME_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function unlockAchievement(id) {
    const ach = loadAchievements();
    if (ach[id]) return false;
    ach[id] = Date.now();
    saveAchievements(ach);
    showAchievementToast(id);
    return true;
  }
  function checkAchievements({ vars, stats, pergame, now }) {
    const money = Number(vars.money) || 0;
    const round = Number(vars.round) || 0;
    if (stats.gamesPlayed >= 1) unlockAchievement('first_game');
    if (round >= 25) unlockAchievement('round_25');
    if (round >= 40) unlockAchievement('round_40');
    if (round >= 50) unlockAchievement('round_50');
    if (round >= 75) unlockAchievement('round_75');
    if (round >= 100) unlockAchievement('round_100');
    if (stats.gamesPlayed >= 10) unlockAchievement('games_10');
    if (stats.totalTimePlayed >= 3600) unlockAchievement('time_1hr');
    if (stats.totalTimePlayed >= 36000) unlockAchievement('time_10hr');
    if (money >= 100000) unlockAchievement('high_roller');
    if (settings.infiniteMoney && settings.godMode) unlockAchievement('cheat_lord');
    if (round >= 50 && pergame.livesLost === 0 && pergame.startingLives > 0) {
      unlockAchievement('no_hit_50');
    }
  }
  function showAchievementToast(id) {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return;
    const el = h('div', { className: 'dt-achievement-toast' },
      h('div', { className: 'dt-ach-icon' }, '🏆'),
      h('div', null,
        h('div', { className: 'dt-ach-title' }, 'Achievement unlocked'),
        h('div', { className: 'dt-ach-name' }, def.name),
        h('div', { className: 'dt-ach-desc' }, def.desc)));
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('dt-ach-show'));
    setTimeout(() => {
      el.classList.remove('dt-ach-show');
      setTimeout(() => el.remove(), 400);
    }, 4500);
  }

  // --- Challenge of the Day --------------------------------------------------
  // Deterministic: seed = hash of today's YYYY-MM-DD, so everyone with the same
  // date sees the same map / modifiers / round goal. Completion is per-day.
  const COTD_KEY = 'btd5_cotd_v1';
  const COTD_GOALS = [20, 30, 40, 50, 60, 75, 100];
  const COTD_MOD_POOL = ['half_cash', 'double_cash', 'chimps_lite', 'no_fast_forward', 'low_lives'];
  function todayKey() { return new Date().toISOString().slice(0, 10); }
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  async function rollChallengeOfTheDay() {
    const data = await loadBtd6Maps();
    if (!data || data.error || !data.maps || !data.maps.length) return null;
    const key = todayKey();
    const rng = mulberry32(hashString(key));
    const map = data.maps[Math.floor(rng() * data.maps.length)];
    const diff = primaryDifficulty(map);
    const goal = COTD_GOALS[Math.floor(rng() * COTD_GOALS.length)];
    const mods = [];
    // Gentler for Expert/Advanced, harsher for Beginner/Intermediate
    const bias = diff === 'Expert' ? 0.2 : diff === 'Advanced' ? 0.3 : 0.5;
    for (const m of COTD_MOD_POOL) {
      if (rng() < bias) mods.push(m);
    }
    if (mods.length > 2) mods.length = 2; // cap at 2 modifiers
    return { date: key, map, difficulty: diff, goal, modifiers: mods };
  }
  function loadCotdState() {
    try { return JSON.parse(localStorage.getItem(COTD_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCotdState(s) {
    try { localStorage.setItem(COTD_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function cotdStreak() {
    const state = loadCotdState();
    let n = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const k = d.toISOString().slice(0, 10);
      if (state[k] && state[k].completed) { n++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return n;
  }
  function markCotdComplete() {
    const state = loadCotdState();
    const k = todayKey();
    state[k] = { completed: true, at: Date.now() };
    saveCotdState(state);
    unlockAchievement('cotd_done');
    if (cotdStreak() >= 7) unlockAchievement('cotd_streak_7');
  }
  const COTD_MOD_LABELS = {
    half_cash: 'Half Cash',
    double_cash: 'Double Cash',
    chimps_lite: 'CHIMPS lite',
    no_fast_forward: 'No Fast Forward',
    low_lives: 'Start with 1 life',
  };

  // --- Full tower save / restore (EXPERIMENTAL) ------------------------------
  // Snapshot every non-stage clone's position, direction, size, visibility,
  // costume, and local variables, plus the complete set of stage variables.
  // Restore by disposing current clones and recreating them from the snapshot.
  // The game's `control_start_as_clone` hats fire on makeClone(); we re-apply
  // state twice (sync, then one-frame later) to outrun any init-script writes.
  const FULL_KEY = 'btd5_full_snap_v1';
  function snapshotFull() {
    const rt = window.vm && window.vm.runtime;
    if (!rt) return null;
    const stage = rt.getTargetForStage();
    const snap = { v: 1, t: Date.now(), stageVars: {}, clones: [] };
    for (const id in stage.variables) {
      const v = stage.variables[id];
      snap.stageVars[v.name] = v.value;
    }
    for (const t of rt.targets) {
      if (!t || t.isOriginal || t.isStage || !t.sprite) continue;
      const vars = {};
      for (const vid in t.variables) vars[t.variables[vid].name] = t.variables[vid].value;
      snap.clones.push({
        sprite: t.sprite.name,
        x: t.x, y: t.y, direction: t.direction,
        size: t.size, visible: t.visible,
        costume: typeof t.currentCostume === 'number' ? t.currentCostume : 0,
        vars,
      });
    }
    return snap;
  }
  function saveFull() {
    const snap = snapshotFull();
    if (!snap) return null;
    try { localStorage.setItem(FULL_KEY, JSON.stringify(snap)); } catch (e) {
      return { error: String(e) };
    }
    return snap;
  }
  function loadFull() {
    try {
      const raw = localStorage.getItem(FULL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function applyCloneState(target, entry) {
    try {
      if (typeof target.setXY === 'function') target.setXY(entry.x, entry.y);
      if (typeof target.setDirection === 'function') target.setDirection(entry.direction);
      if (typeof target.setSize === 'function') target.setSize(entry.size);
      if (typeof target.setVisible === 'function') target.setVisible(!!entry.visible);
      if (typeof target.setCostume === 'function') {
        try { target.setCostume(entry.costume); } catch (e) {}
      }
      if (entry.vars) {
        for (const vid in target.variables) {
          const vObj = target.variables[vid];
          if (Object.prototype.hasOwnProperty.call(entry.vars, vObj.name)) {
            vObj.value = entry.vars[vObj.name];
          }
        }
      }
    } catch (e) {}
  }
  function restoreFull(snap) {
    if (!snap || !snap.clones) return { created: 0, errors: ['empty snapshot'] };
    const rt = window.vm && window.vm.runtime;
    if (!rt) return { created: 0, errors: ['no runtime'] };
    const errors = [];
    // Stage variables first
    const stage = rt.getTargetForStage();
    for (const id in stage.variables) {
      const v = stage.variables[id];
      if (snap.stageVars && Object.prototype.hasOwnProperty.call(snap.stageVars, v.name)) {
        v.value = snap.stageVars[v.name];
      }
    }
    // Dispose existing clones (not originals)
    const toRemove = rt.targets.filter((t) => t && !t.isOriginal && !t.isStage);
    for (const t of toRemove) {
      try { rt.disposeTarget(t); } catch (e) { errors.push('dispose: ' + e.message); }
    }
    // Rebuild clones from the snapshot. Note: makeClone() creates the clone but
    // does NOT add it to runtime.targets; Scratch's own control_create_clone_of
    // block does that push itself, and we have to do the same here.
    let created = 0;
    const pending = [];
    for (const entry of snap.clones) {
      const original = rt.targets.find((t) => t && t.isOriginal && t.sprite && t.sprite.name === entry.sprite);
      if (!original || typeof original.makeClone !== 'function') continue;
      const clone = original.makeClone();
      if (!clone) continue;
      rt.targets.push(clone);
      if (typeof clone.goBehindOther === 'function') {
        try { clone.goBehindOther(original); } catch (e) {}
      }
      applyCloneState(clone, entry);
      pending.push([clone, entry]);
      created++;
    }
    // Re-apply once more next frame to beat any clone-init script writes
    requestAnimationFrame(() => {
      for (const [clone, entry] of pending) {
        if (!clone.sprite) continue; // already disposed
        applyCloneState(clone, entry);
      }
    });
    return { created, errors };
  }

  function guardReset(origFn, action) {
    let confirming = false;
    let lastResetAt = 0;
    return function guarded(...args) {
      const now = Date.now();
      // Suppress a second fire within 1 s of a just-confirmed reset: iOS Safari
      // can replay queued taps the moment the confirm closes.
      if (confirming || now - lastResetAt < 1000) return undefined;
      try {
        const vars = readStageVars();
        const round = Number(vars.round);
        const wave = Number(vars.wave);
        if (round > 0 || wave > 0) {
          confirming = true;
          const ok = window.confirm(
            `${action} the game? Round ${round || 1}, wave ${wave || 1}, $${vars.money || 0}, ${vars.lives || 0} lives will be lost.\n\nTip: your progress is auto-saved; use "Restore saved progress" in the Settings panel to get it back.`
          );
          confirming = false;
          if (!ok) return undefined;
          saveSnapshot('pre-' + action.toLowerCase()); // one final save before reset
        }
        lastResetAt = Date.now();
      } catch (e) {}
      return origFn.apply(this, args);
    };
  }

  function wrapScaffoldingResets() {
    const sc = window.scaffolding;
    if (!sc || sc.__btd5Guarded) return;
    sc.__btd5Guarded = true;
    if (typeof sc.greenFlag === 'function') {
      const orig = sc.greenFlag.bind(sc);
      sc.greenFlag = guardReset(orig, 'Restart');
    }
    if (typeof sc.stopAll === 'function') {
      const orig = sc.stopAll.bind(sc);
      sc.stopAll = guardReset(orig, 'Stop');
    }
  }

  // Warn before unload if there's meaningful progress to lose.
  function installBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
      try {
        saveSnapshot('unload');
        const vars = readStageVars();
        if (Number(vars.round) > 0 || Number(vars.wave) > 0) {
          e.preventDefault();
          e.returnValue = ''; // required by some browsers; iOS Safari ignores it
          return '';
        }
      } catch (err) {}
    });
  }

  // Spectate link: encodes the current game state (round/money/lives) in a URL fragment
  function makeSpectateLink() {
    const money = findStageVar('money'), lives = findStageVar('lives'), round = findStageVar('round');
    const snap = {
      t: Date.now(),
      round: round ? round.value : null,
      money: money ? money.value : null,
      lives: lives ? lives.value : null,
    };
    const u = new URL(location.href);
    u.hash = 'watch=' + btoa(JSON.stringify(snap));
    return u.toString();
  }
  function renderSpectateBanner() {
    if (!location.hash.startsWith('#watch=')) return;
    try {
      const snap = JSON.parse(atob(location.hash.slice('#watch='.length)));
      const age = Math.round((Date.now() - (snap.t || 0)) / 1000);
      const b = h('div', { id: 'dt-watch' }, `Watching snapshot — Round ${snap.round}, $${snap.money}, ${snap.lives} lives (${age}s ago)`);
      Object.assign(b.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: 101,
        padding: '8px 48px 8px 16px', background: 'rgba(59,130,246,0.95)', color: '#fff',
        font: '12px system-ui', textAlign: 'center',
      });
      const x = h('button', { type: 'button' }, '×');
      Object.assign(x.style, {
        position: 'absolute', right: '8px', top: '4px', background: 'transparent',
        border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer',
      });
      x.onclick = () => { b.remove(); location.hash = ''; };
      b.appendChild(x);
      document.body.appendChild(b);
    } catch (e) {}
  }

  // FPS / stats overlay
  let overlayEl = null;
  let overlayRaf = 0;
  const frameTimes = [];
  function updateOverlay() {
    if (!overlayEl) return;
    const vm = window.vm;
    const runtime = vm && vm.runtime;
    const targets = runtime ? runtime.targets : [];
    const clones = targets.filter((t) => t && !t.isOriginal).length;
    const originals = targets.filter((t) => t && t.isOriginal).length;
    // median frame interval over the last ~1 s
    frameTimes.sort((a, b) => a - b);
    const mid = frameTimes[Math.floor(frameTimes.length / 2)] || 0;
    const fps = mid ? Math.round(1000 / mid) : 0;
    overlayEl.classList.toggle('dt-warn', fps > 0 && fps < 50);
    overlayEl.classList.toggle('dt-bad', fps > 0 && fps < 25);
    const money = findStageVar('money');
    const lives = findStageVar('lives');
    const round = findStageVar('round');
    overlayEl.textContent =
      `FPS: ${fps}\n` +
      `Clones: ${clones}\n` +
      `Sprites: ${originals}\n` +
      `Threads: ${runtime ? runtime.threads.length : 0}\n` +
      (round ? `Round: ${round.value}\n` : '') +
      (money ? `Money: ${money.value}\n` : '') +
      (lives ? `Lives: ${lives.value}` : '');
  }
  function ensureOverlay() {
    if (settings.overlay) {
      if (!overlayEl) {
        overlayEl = h('div', { id: 'dt-overlay' });
        document.body.appendChild(overlayEl);
      }
      overlayEl.hidden = false;
      if (!overlayRaf) {
        let last = performance.now();
        const loop = (now) => {
          frameTimes.push(now - last);
          if (frameTimes.length > 60) frameTimes.shift();
          last = now;
          overlayRaf = requestAnimationFrame(loop);
        };
        overlayRaf = requestAnimationFrame(loop);
        setInterval(updateOverlay, 250);
      }
    } else if (overlayEl) {
      overlayEl.hidden = true;
    }
  }

  function buildPanel() {
    const panel = h('section', { id: 'dt-panel' });
    panel.appendChild(h('h2', null, 'Settings'));
    panel.appendChild(h('p', { className: 'dt-sub' }, 'Changes save to this device and apply after reload where noted.'));

    // Graphics
    const graphics = h('section');
    graphics.appendChild(h('h3', null, 'Graphics'));
    graphics.appendChild(row('Render quality',
      makeSelect('quality', [['low', 'Low (fastest)'], ['normal', 'Normal'], ['high', 'High']]),
      'Low uses nearest-neighbour MIPs; High re-rasterises SVGs.'));
    graphics.appendChild(row('Max texture size',
      makeSelect('maxTexture', [[512, '512'], [1024, '1024'], [2048, '2048']]),
      'Smaller = less GPU memory and faster, but blurrier when zoomed.'));
    graphics.appendChild(row('Interpolation',
      makeToggle('interpolation'),
      'Smooths motion between simulation ticks.'));
    panel.appendChild(graphics);

    // Performance
    const perf = h('section');
    perf.appendChild(h('h3', null, 'Performance'));
    perf.appendChild(row('In-game fast forward',
      makeSelect('inGameSpeed', [
        [0, 'Game default (toggle)'],
        [1, '1x (locked)'],
        [2, '2x (locked)'],
        [3, '3x'],
        [5, '5x'],
        [10, '10x'],
        [15, '15x'],
        [20, '20x'],
      ]),
      'Overrides the game’s own Fast Forward? variable, which the game multiplies into bloon speed, wave timers, and projectile cooldowns. Higher values keep the engine running at normal cost — most useful for late waves.'));
    perf.appendChild(row('Engine speed',
      makeSelect('targetFps', [
        [15, '0.5x (slow-mo)'],
        [30, '1x (normal)'],
        [60, '2x'],
        [90, '3x'],
        [150, '5x'],
        [300, '10x'],
        [450, '15x'],
        [600, '20x'],
      ]),
      'Makes the Scratch VM tick faster. 5x and above auto-enable turbo. Real speedup is CPU-bound — pair with in-game FF for compound speed.'));
    perf.appendChild(row('Turbo mode',
      makeToggle('turbo'),
      'Removes per-tick yielding. Implied at engine 5x and above.'));
    panel.appendChild(perf);

    // Developer / cheats
    const dev = h('section');
    dev.appendChild(h('h3', null, 'Developer / Cheats'));
    dev.appendChild(row('FPS & stats overlay', makeToggle('overlay')));
    dev.appendChild(row('Infinite money', makeToggle('infiniteMoney'), 'Tops money up to 999,999 twice a second.'));
    dev.appendChild(row('God mode', makeToggle('godMode'), 'Keeps lives at 999.'));
    dev.appendChild(makeCheat('Set money', 'money', 10000));
    dev.appendChild(makeCheat('Set lives', 'lives', 999));
    dev.appendChild(makeCheat('Set round', 'round', 30));

    // Round skip quick buttons
    const skipBtns = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-end' } });
    for (const r of [5, 10, 20, 30, 40, 50, 60, 80, 100]) {
      const b = h('button', { type: 'button' }, 'R' + r);
      b.style.cssText = 'padding:3px 7px;font-size:11px;min-width:34px';
      b.onclick = () => {
        setStageVar('round', r);
        b.textContent = '✓';
        setTimeout(() => (b.textContent = 'R' + r), 600);
      };
      skipBtns.appendChild(b);
    }
    dev.appendChild(row('Skip to round', skipBtns, 'Jump the round variable directly.'));
    const pauseBtn = h('button', { type: 'button' }, 'Pause');
    pauseBtn.onclick = () => {
      const vm = window.vm; if (!vm || !vm.setPaused) return;
      const paused = !vm.runtime._paused;
      vm.setPaused(paused);
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    };
    dev.appendChild(row('Pause/resume game', pauseBtn));
    const greenBtn = h('button', { type: 'button' }, 'Green flag');
    greenBtn.onclick = () => window.scaffolding && window.scaffolding.greenFlag && window.scaffolding.greenFlag();
    dev.appendChild(row('Restart project', greenBtn));

    // Restore the last auto-saved progress snapshot (money, lives, round, wave, FF?)
    const restoreBtn = h('button', { type: 'button' }, 'Restore');
    const restoreStatus = h('small', null, '');
    const refreshRestore = () => {
      const s = loadSnapshot();
      if (s) {
        const age = Math.max(0, Math.round((Date.now() - s.t) / 1000));
        restoreStatus.textContent = `Saved ${age < 60 ? age + 's' : Math.round(age / 60) + 'm'} ago — round ${s.vars.round || '?'}, $${s.vars.money || 0}, ${s.vars.lives || 0} lives`;
        restoreBtn.disabled = false;
      } else {
        restoreStatus.textContent = 'No recent auto-save (rounds > 0 auto-save every 5s).';
        restoreBtn.disabled = true;
      }
    };
    restoreBtn.onclick = () => {
      const s = loadSnapshot();
      if (!s) return;
      const applied = writeStageVars(s.vars);
      restoreBtn.textContent = 'Restored (' + applied + ') ✓';
      setTimeout(() => (restoreBtn.textContent = 'Restore'), 1200);
    };
    setInterval(refreshRestore, 2000);
    refreshRestore();
    dev.appendChild(row('Restore saved progress', restoreBtn, ''));
    const restoreRow = h('div', { className: 'dt-row', style: { marginTop: '-4px' } },
      h('div', null, restoreStatus));
    dev.appendChild(restoreRow);

    // Export / import autosave + stats + settings as a single JSON file
    const exportBtn = h('button', { type: 'button' }, 'Export');
    const importBtn = h('button', { type: 'button' }, 'Import');
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json' });
    fileInput.style.display = 'none';
    exportBtn.onclick = () => {
      const payload = {
        app: 'btd5-demo-v4-devtools',
        version: 1,
        exportedAt: new Date().toISOString(),
        autosave: loadSnapshot(),
        stats: loadStats(),
        settings: { ...settings },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const a = h('a', { href: url, download: 'btd5-save-' + stamp + '.json' });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
      exportBtn.textContent = 'Exported ✓';
      setTimeout(() => (exportBtn.textContent = 'Export'), 1200);
    };
    fileInput.onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        if (data.app !== 'btd5-demo-v4-devtools') {
          if (!confirm('This file was not exported by this app. Import anyway?')) {
            fileInput.value = ''; return;
          }
        }
        let n = 0;
        if (data.autosave) { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data.autosave)); n++; }
        if (data.stats) { localStorage.setItem(STATS_KEY, JSON.stringify(data.stats)); n++; }
        if (data.settings && typeof data.settings === 'object') {
          Object.assign(settings, data.settings);
          try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (err) {}
          apply();
          n++;
        }
        importBtn.textContent = 'Imported ' + n + ' section' + (n === 1 ? '' : 's') + ' ✓';
        setTimeout(() => (importBtn.textContent = 'Import'), 1800);
        refreshRestore();
      } catch (err) {
        alert('Import failed: ' + err.message);
      } finally {
        fileInput.value = ''; // allow re-import of the same file
      }
    };
    importBtn.onclick = () => fileInput.click();
    document.body.appendChild(fileInput);
    const exImRow = h('div', { className: 'dt-row' },
      h('div', null, 'Save file', h('small', null, 'JSON: autosave + stats + settings')),
      h('div', { style: { display: 'flex', gap: '6px' } }, exportBtn, importBtn));
    dev.appendChild(exImRow);
    const stats = h('div', { className: 'dt-stats' },
      h('div', null, h('span', null, 'render:'), h('span', null, 'WebGL')),
      h('div', null, h('span', null, 'ua:'), h('span', null, navigator.hardwareConcurrency ? navigator.hardwareConcurrency + '-core' : '?'))
    );
    dev.appendChild(stats);
    panel.appendChild(dev);

    // Statistics (local-only, tracked by autoTick()).
    const statsSection = h('section');
    statsSection.appendChild(h('h3', null, 'Statistics'));
    const statsGrid = h('div', { className: 'dt-stats' });
    statsSection.appendChild(statsGrid);
    const resetStatsBtn = h('button', { type: 'button' }, 'Reset');
    resetStatsBtn.onclick = () => {
      if (confirm('Clear all statistics? This cannot be undone.')) {
        resetStats();
        renderStatsPanel();
      }
    };
    statsSection.appendChild(row('Clear counters', resetStatsBtn));
    function renderStatsPanel() {
      const s = loadStats();
      const t = s.totalTimePlayed;
      const hrs = Math.floor(t / 3600);
      const mins = Math.floor((t % 3600) / 60);
      const secs = Math.floor(t % 60);
      const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const last = s.lastPlayedAt ? new Date(s.lastPlayedAt) : null;
      const lastStr = last ? last.toLocaleString() : 'never';
      statsGrid.innerHTML = '';
      const pairs = [
        ['Games played', String(s.gamesPlayed)],
        ['Highest round', String(s.highestRound)],
        ['Highest wave', String(s.highestWave)],
        ['Time played', timeStr],
        ['Last played', lastStr],
      ];
      for (const [k, v] of pairs) {
        statsGrid.appendChild(h('div', null, h('span', null, k), h('span', null, v)));
      }
    }
    renderStatsPanel();
    setInterval(renderStatsPanel, 2000);
    panel.appendChild(statsSection);

    // Achievements
    const achSection = h('section');
    achSection.appendChild(h('h3', null, 'Achievements'));
    const achList = h('div', { className: 'dt-ach-list' });
    achSection.appendChild(achList);
    function renderAchievements() {
      const unlocked = loadAchievements();
      const total = ACHIEVEMENTS.length;
      const done = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
      achList.innerHTML = '';
      achList.appendChild(h('div', { className: 'dt-ach-count' }, `${done} / ${total} unlocked`));
      for (const a of ACHIEVEMENTS) {
        const on = !!unlocked[a.id];
        const item = h('div', { className: 'dt-ach-item' + (on ? ' dt-ach-on' : '') },
          h('span', { className: 'dt-ach-badge' }, on ? '✓' : '·'),
          h('div', { style: { flex: '1 1 auto' } },
            h('div', { className: 'dt-ach-name-small' }, a.name),
            h('div', { className: 'dt-ach-desc-small' }, a.desc)));
        achList.appendChild(item);
      }
    }
    renderAchievements();
    setInterval(renderAchievements, 4000);
    panel.appendChild(achSection);

    // Challenge of the Day
    const cotdSection = h('section');
    cotdSection.appendChild(h('h3', null, 'Challenge of the Day'));
    cotdSection.appendChild(h('p', { className: 'dt-sub', style: { margin: '-6px 0 10px' } },
      'A deterministic daily picked from the BTD6 map list. Everyone sees the same map, goal, and modifiers today.'));
    const cotdCard = h('div', { className: 'dt-cotd-card' }, h('em', null, 'Loading…'));
    cotdSection.appendChild(cotdCard);
    panel.appendChild(cotdSection);
    (async () => {
      const c = await rollChallengeOfTheDay();
      if (!c) {
        cotdCard.innerHTML = '';
        cotdCard.appendChild(h('em', null, 'Map data not loaded. Run scripts/update_btd6_maps.sh.'));
        return;
      }
      const state = loadCotdState();
      const done = state[c.date] && state[c.date].completed;
      const streak = cotdStreak();
      const renderCard = () => {
        cotdCard.innerHTML = '';
        cotdCard.appendChild(h('div', { className: 'dt-cotd-date' }, c.date + (streak > 1 ? ' · 🔥 ' + streak + '-day streak' : '')));
        cotdCard.appendChild(h('div', { className: 'dt-cotd-map' },
          h('span', { className: 'dt-badge dt-diff-' + c.difficulty.toLowerCase() }, c.difficulty),
          h('span', { style: { marginLeft: '6px' } }, c.map.name)));
        cotdCard.appendChild(h('div', { className: 'dt-cotd-goal' }, 'Goal: reach round ' + c.goal));
        if (c.modifiers.length) {
          const chips = h('div', { className: 'dt-cotd-mods' });
          for (const m of c.modifiers) chips.appendChild(h('span', { className: 'dt-cotd-chip' }, COTD_MOD_LABELS[m] || m));
          cotdCard.appendChild(chips);
        }
        const applyBtn = h('button', { type: 'button' }, 'Apply modifiers');
        applyBtn.onclick = () => {
          for (const m of c.modifiers) {
            if (m === 'half_cash') setSetting('halfCash', true);
            else if (m === 'double_cash') setSetting('doubleCash', true);
            else if (m === 'chimps_lite') setSetting('chimpsLite', true);
            else if (m === 'no_fast_forward') setSetting('inGameSpeed', 1);
            else if (m === 'low_lives') { const lv = findStageVar('lives'); if (lv) lv.value = 1; }
          }
          applyBtn.textContent = 'Applied ✓';
          setTimeout(() => (applyBtn.textContent = 'Apply modifiers'), 1500);
        };
        const doneBtn = h('button', { type: 'button' }, done ? 'Completed ✓' : 'Mark complete');
        doneBtn.disabled = !!done;
        doneBtn.onclick = () => { markCotdComplete(); renderCard(); };
        cotdCard.appendChild(h('div', { style: { marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } }, applyBtn, doneBtn));
      };
      renderCard();
    })();

    // Full Tower Save / Restore (EXPERIMENTAL)
    const fullSection = h('section');
    fullSection.appendChild(h('h3', null, 'Full Save / Restore (experimental)'));
    fullSection.appendChild(h('div', { className: 'dt-note' },
      'Snapshots every tower and sprite clone, not just the stage counters. Fragile: the Scratch runtime’s clone init scripts may overwrite some values, so your towers can look right but misbehave. Treat as a bonus, keep the plain Restore as the safe path.'));
    const fullSaveBtn = h('button', { type: 'button' }, 'Save snapshot');
    const fullLoadBtn = h('button', { type: 'button' }, 'Restore snapshot');
    const fullStatus = h('small', { style: { display: 'block', marginTop: '6px', color: '#a0a0aa' } }, '');
    function renderFullStatus() {
      const s = loadFull();
      if (!s) {
        fullStatus.textContent = 'No snapshot saved.';
        fullLoadBtn.disabled = true;
      } else {
        const ago = Math.max(0, Math.round((Date.now() - s.t) / 1000));
        const ageStr = ago < 60 ? ago + 's' : ago < 3600 ? Math.round(ago / 60) + 'm' : Math.round(ago / 3600) + 'h';
        fullStatus.textContent = `${s.clones.length} clones · ${Object.keys(s.stageVars || {}).length} stage vars · saved ${ageStr} ago`;
        fullLoadBtn.disabled = false;
      }
    }
    fullSaveBtn.onclick = () => {
      const s = saveFull();
      if (s && !s.error) {
        fullSaveBtn.textContent = `Saved (${s.clones.length} clones) ✓`;
      } else {
        fullSaveBtn.textContent = s && s.error ? 'Error' : 'Failed';
      }
      renderFullStatus();
      setTimeout(() => (fullSaveBtn.textContent = 'Save snapshot'), 1500);
    };
    fullLoadBtn.onclick = () => {
      const snap = loadFull();
      if (!snap) return;
      if (!confirm(`Restore snapshot with ${snap.clones.length} clones? Existing towers will be removed and recreated.`)) return;
      const r = restoreFull(snap);
      fullLoadBtn.textContent = `Restored ${r.created} ✓`;
      setTimeout(() => (fullLoadBtn.textContent = 'Restore snapshot'), 1500);
    };
    renderFullStatus();
    setInterval(renderFullStatus, 3000);
    fullSection.appendChild(h('div', { className: 'dt-row' },
      h('div', null, 'Full snapshot'),
      h('div', { style: { display: 'flex', gap: '6px' } }, fullSaveBtn, fullLoadBtn)));
    fullSection.appendChild(fullStatus);
    panel.appendChild(fullSection);

    // Game Modes (BTD5 demo's own difficulty broadcasts, exposed as quick-launch buttons)
    const modes = h('section');
    modes.appendChild(h('h3', null, 'Game Modes'));
    modes.appendChild(h('p', { className: 'dt-sub', style: { margin: '-6px 0 10px' } },
      'Broadcasts the game’s built-in mode events. If a button only opens a confirm dialog, click Play there.'));
    const modeGrid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' } });
    for (const [name, label] of [
      ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'],
      ['impoppable', 'Impoppable'], ['apopalypse', 'Apopalypse'],
      ['deflation', 'Deflation'], ['sandbox', 'Sandbox'], ['Freeplay', 'Freeplay'],
    ]) {
      const b = h('button', { type: 'button' }, label);
      b.onclick = () => broadcast(name);
      modeGrid.appendChild(b);
    }
    modes.appendChild(modeGrid);
    panel.appendChild(modes);

    // Modifier Modes (BTD6-inspired, implemented client-side on money/lives)
    const mods = h('section');
    mods.appendChild(h('h3', null, 'Modifier Modes'));
    mods.appendChild(h('p', { className: 'dt-sub', style: { margin: '-6px 0 10px' } },
      'BTD6-style modifiers approximated by watching the money/lives variables.'));
    mods.appendChild(row('Half Cash', makeToggle('halfCash'), 'Halves any money gain.'));
    mods.appendChild(row('Double Cash', makeToggle('doubleCash'), 'Doubles any money gain.'));
    mods.appendChild(row('CHIMPS lite', makeToggle('chimpsLite'),
      'Restart the project the moment you lose a life. (Powers, Continues, Selling, Monkey Knowledge are already absent in the demo.)'));
    panel.appendChild(mods);

    // Co-op
    const coop = h('section');
    coop.appendChild(h('h3', null, 'Co-op'));
    coop.appendChild(h('div', { className: 'dt-note' },
      'BTD6-style real-time co-op (shared economy, shared bloons, multiple inputs on one game) requires the game engine to be built for it; this Scratch project isn’t. ',
      'What works here: Pass & Play on one device, and a snapshot link your friend can open on theirs.'
    ));
    coop.appendChild(row('Pass & Play', makeToggle('passPlayEnabled'),
      'Two players alternate turns on this device. Game pauses at the end of each turn.'));
    const turnLenInp = h('input', { type: 'number', min: 10, max: 600, value: String(settings.passPlayTurnSec) });
    turnLenInp.onchange = () => {
      const n = Math.max(10, Math.min(600, Number(turnLenInp.value) || 60));
      turnLenInp.value = String(n);
      setSetting('passPlayTurnSec', n);
    };
    coop.appendChild(row('Turn length (sec)', turnLenInp));
    const watchBtn = h('button', { type: 'button' }, 'Copy spectate link');
    watchBtn.onclick = async () => {
      const url = makeSpectateLink();
      try { await navigator.clipboard.writeText(url); watchBtn.textContent = 'Copied ✓'; }
      catch (e) { prompt('Spectate link (copy):', url); watchBtn.textContent = 'Link shown'; }
      setTimeout(() => (watchBtn.textContent = 'Copy spectate link'), 1500);
    };
    coop.appendChild(row('Spectate snapshot', watchBtn,
      'Sends a one-off round/money/lives snapshot in the URL. Not live.'));
    panel.appendChild(coop);

    // BTD6 Map Reference (data bundled from scripts/fetch_btd6_maps.py)
    const mapRef = h('section');
    mapRef.appendChild(h('h3', null, 'BTD6 Map Reference'));
    mapRef.appendChild(h('div', { className: 'dt-note' },
      'These are the real BTD6 map names and difficulty ratings, pulled from three public GitHub sources. ',
      'Not playable in this Scratch demo — the demo’s tracks are its own — but useful as a reference or as a thematic challenge target.'
    ));
    const search = h('input', { type: 'text', placeholder: 'Search by name…' });
    const diffSelect = h('select');
    for (const d of ['All', 'Beginner', 'Intermediate', 'Advanced', 'Expert']) {
      diffSelect.appendChild(h('option', { value: d }, d));
    }
    mapRef.appendChild(h('div', { className: 'dt-map-controls' }, search, diffSelect));
    const list = h('div', { className: 'dt-map-list' });
    mapRef.appendChild(list);
    const randomBtn = h('button', { type: 'button' }, 'Pick a random map');
    mapRef.appendChild(row('Thematic challenge', randomBtn,
      'Picks a random BTD6 map and shows it as a goal banner over the game.'));
    const refreshNote = h('p', { className: 'dt-sub', style: { margin: '8px 0 0' } },
      'Data snapshot bundled at ./btd6_maps.json. To refresh: run scripts/update_btd6_maps.sh');
    mapRef.appendChild(refreshNote);
    panel.appendChild(mapRef);

    // Populate the map list once data loads
    loadBtd6Maps().then((data) => {
      if (!data || data.error) {
        list.appendChild(h('div', { className: 'dt-map-empty' },
          'Map data could not be loaded (' + (data && data.error ? data.error : 'unknown') + '). ',
          'Run scripts/update_btd6_maps.sh to generate btd6_maps.json.'));
        randomBtn.disabled = true;
        return;
      }
      const maps = data.maps || [];
      const renderList = () => {
        list.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        const want = diffSelect.value;
        let shown = 0;
        for (const m of maps) {
          const diff = primaryDifficulty(m);
          if (want !== 'All' && diff !== want) continue;
          if (q && !m.name.toLowerCase().includes(q)) continue;
          const extra = (m.extra && m.extra.superbot) || {};
          const isConflict = typeof m.difficulty === 'object';
          const badgeCls = 'dt-badge dt-diff-' + (isConflict ? 'mixed' : diff.toLowerCase());
          const item = h('div', { className: 'dt-map' },
            h('span', { className: badgeCls, title: isConflict ? 'Sources disagree' : diff }, diff.substr(0, 3)),
            h('span', { className: 'dt-map-name' }, m.name),
            extra.has_water ? h('span', { className: 'dt-map-meta', title: 'has water tiles' }, '~') : null,
          );
          item.onclick = () => showChallenge(m);
          list.appendChild(item);
          shown++;
        }
        if (shown === 0) {
          list.appendChild(h('div', { className: 'dt-map-empty' }, 'No maps match.'));
        }
      };
      search.oninput = renderList;
      diffSelect.onchange = renderList;
      randomBtn.onclick = () => {
        const filtered = maps.filter((m) => {
          if (diffSelect.value !== 'All' && primaryDifficulty(m) !== diffSelect.value) return false;
          const q = search.value.trim().toLowerCase();
          return !q || m.name.toLowerCase().includes(q);
        });
        const pool = filtered.length ? filtered : maps;
        showChallenge(pool[Math.floor(Math.random() * pool.length)]);
      };
      renderList();
    });

    // Mod Helper disclosure
    const note = h('section');
    note.appendChild(h('h3', null, 'About "BTD6 Mod Helper"'));
    note.appendChild(h('div', { className: 'dt-note' },
      'The real ',
      h('a', { href: 'https://github.com/doombubbles/mod-helper', target: '_blank', rel: 'noopener' }, 'BTD6 Mod Helper'),
      ' is a MelonLoader/Harmony mod for the Unity-based BTD6. This game is a Scratch project packaged as HTML, so its hook points don\'t exist here. The cheats above are its spiritual sibling, built on what the Scratch VM exposes.'
    ));
    panel.appendChild(note);

    document.body.appendChild(panel);

    const toggle = h('button', { id: 'dt-toggle', type: 'button', title: 'Settings & dev tools' }, '⚙');
    toggle.onclick = () => panel.classList.toggle('open');
    document.body.appendChild(toggle);

    // Keep watchdogs & co-op state in sync with toggles
    listeners.add((k) => {
      if (k === 'halfCash' || k === 'doubleCash') enforceExclusive(k);
      if (k === 'infiniteMoney' || k === 'godMode' || k === 'halfCash'
          || k === 'doubleCash' || k === 'chimpsLite' || k === 'inGameSpeed') {
        const active = (k === 'inGameSpeed') ? settings[k] > 0 : settings[k];
        if (active) startWatchdogs(); else stopWatchdogsIfIdle();
      }
      if (k === 'overlay') ensureOverlay();
      if (k === 'passPlayEnabled') {
        if (settings[k]) passPlayStart(); else passPlayStop();
      }
    });
  }

  onReady(() => {
    apply();
    wrapScaffoldingResets();
    installBeforeUnload();
    startAutosave();
    buildPanel();
    ensureOverlay();
    renderSpectateBanner();
    if (settings.infiniteMoney || settings.godMode || settings.halfCash
        || settings.doubleCash || settings.chimpsLite || settings.inGameSpeed > 0) startWatchdogs();
    if (settings.passPlayEnabled) passPlayStart();
  });
})();

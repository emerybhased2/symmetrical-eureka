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
    targetFps: 30,           // 15 | 20 | 30 | 60 | 120
    turbo: false,
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
      if (vm.setTurboMode) vm.setTurboMode(!!settings.turbo);
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
      // Lives
      const lv = findStageVar('lives');
      if (lv) {
        const cur = Number(lv.value);
        if (settings.godMode && cur < 500) { lv.value = 999; lastLives = 999; }
        else if (settings.chimpsLite && lastLives != null && cur < lastLives) {
          // Lost a life under CHIMPS-lite: restart the project.
          try { window.scaffolding.greenFlag(); } catch (e) {}
          lastLives = Number(lv.value);
        } else {
          lastLives = cur;
        }
      }
    }, 150); // 6-7 Hz: fast enough to catch money changes before the game draws them next
  }
  function stopWatchdogsIfIdle() {
    if (settings.infiniteMoney || settings.godMode || settings.halfCash
        || settings.doubleCash || settings.chimpsLite) return;
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
    perf.appendChild(row('Target FPS',
      makeSelect('targetFps', [[15, '15'], [20, '20'], [30, '30 (normal)'], [60, '60'], [120, '120']]),
      'The simulation rate. Higher = faster gameplay too.'));
    perf.appendChild(row('Turbo mode',
      makeToggle('turbo'),
      'Removes per-tick yielding. Game runs as fast as the CPU allows.'));
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
    const stats = h('div', { className: 'dt-stats' },
      h('div', null, h('span', null, 'render:'), h('span', null, 'WebGL')),
      h('div', null, h('span', null, 'ua:'), h('span', null, navigator.hardwareConcurrency ? navigator.hardwareConcurrency + '-core' : '?'))
    );
    dev.appendChild(stats);
    panel.appendChild(dev);

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
          || k === 'doubleCash' || k === 'chimpsLite') {
        if (settings[k]) startWatchdogs(); else stopWatchdogsIfIdle();
      }
      if (k === 'overlay') ensureOverlay();
      if (k === 'passPlayEnabled') {
        if (settings[k]) passPlayStart(); else passPlayStop();
      }
    });
  }

  onReady(() => {
    apply();
    buildPanel();
    ensureOverlay();
    renderSpectateBanner();
    if (settings.infiniteMoney || settings.godMode || settings.halfCash
        || settings.doubleCash || settings.chimpsLite) startWatchdogs();
    if (settings.passPlayEnabled) passPlayStart();
  });
})();

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

  // Watchdogs for infinite-money / god-mode
  let watchdogTimer = null;
  function startWatchdogs() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
      if (settings.infiniteMoney) {
        const v = findStageVar('money');
        if (v && Number(v.value) < 99000) v.value = 999999;
      }
      if (settings.godMode) {
        const v = findStageVar('lives');
        if (v && Number(v.value) < 500) v.value = 999;
      }
    }, 500);
  }
  function stopWatchdogsIfIdle() {
    if (settings.infiniteMoney || settings.godMode) return;
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
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

    // Keep watchdogs in sync with toggles
    listeners.add((k) => {
      if (k === 'infiniteMoney' || k === 'godMode') {
        if (settings[k]) startWatchdogs(); else stopWatchdogsIfIdle();
      }
      if (k === 'overlay') ensureOverlay();
    });
  }

  onReady(() => {
    apply();
    buildPanel();
    ensureOverlay();
    if (settings.infiniteMoney || settings.godMode) startWatchdogs();
  });
})();

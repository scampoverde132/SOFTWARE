/**
 * PlanTakeoff suite settings, company branding, keyboard help, and toast UI.
 * Loaded after productivity and Daily Logs, before client update generation.
 */
(function () {
  'use strict';

  const RATE_KEYS = ['walls', 'ceilings', 'doors', 'base', 'trim', 'exterior'];
  const RATE_LABELS = {
    walls: 'Walls / General', ceilings: 'Ceilings', doors: 'Doors',
    base: 'Base', trim: 'Trim', exterior: 'Exterior',
  };
  const FALLBACK = {
    version: 1,
    bidsRoot: '',
    companyName: 'WL Painting Inc.',
    companyLogo: '',
    defaultWastePct: 10,
    rates: {
      walls: { material: 45, labor: 0.85, coverageRate: 350 },
      ceilings: { material: 40, labor: 0.70, coverageRate: 300 },
      doors: { material: 18, labor: 85, coverageRate: 350 },
      base: { material: 45, labor: 1.10, coverageRate: 350 },
      trim: { material: 45, labor: 1.40, coverageRate: 350 },
      exterior: { material: 48, labor: 1.10, coverageRate: 350 },
    },
  };

  let cache = clone(FALLBACK);
  let appState = null;
  let logoDraft = '';
  let loadingPromise = null;

  function clone(value) {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  }
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    const rates = {};
    for (const key of RATE_KEYS) {
      const current = source.rates?.[key] || {};
      const fallback = FALLBACK.rates[key];
      rates[key] = {
        material: Math.max(0, num(current.material, fallback.material)),
        labor: Math.max(0, num(current.labor, fallback.labor)),
        coverageRate: Math.max(1, num(current.coverageRate, fallback.coverageRate)),
      };
    }
    return {
      version: 1,
      bidsRoot: String(source.bidsRoot || FALLBACK.bidsRoot || ''),
      companyName: String(source.companyName || FALLBACK.companyName).trim() || FALLBACK.companyName,
      companyLogo: String(source.companyLogo || ''),
      defaultWastePct: Math.max(0, Math.min(100, num(source.defaultWastePct, FALLBACK.defaultWastePct))),
      rates,
    };
  }

  function captureStore() {
    const S = window.PTStore;
    if (!S || S.__suiteSettingsCapture) return !!S;
    S.__suiteSettingsCapture = true;

    if (typeof S.defaultAppState === 'function') {
      const original = S.defaultAppState;
      S.defaultAppState = function (...args) {
        const state = original.apply(this, args);
        appState = state;
        return state;
      };
    }
    if (typeof S.loadState === 'function') {
      const original = S.loadState;
      S.loadState = async function (...args) {
        const state = await original.apply(this, args);
        appState = state;
        return state;
      };
    }
    if (typeof S.saveState === 'function') {
      const original = S.saveState;
      S.saveState = function (state, ...args) {
        appState = state || appState;
        return original.call(this, state, ...args);
      };
    }
    return true;
  }

  function activeProject() {
    return (appState?.projects || []).find((project) => project.id === appState.activeProjectId) || null;
  }

  function installToast() {
    if (document.getElementById('ptToastStack')) return;
    const style = document.createElement('style');
    style.id = 'ptSuiteShellStyles';
    style.textContent = `
      #ptToastStack{position:fixed;right:18px;bottom:18px;z-index:20000;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 36px))}
      .pt-toast{border:1px solid #334155;border-left:5px solid #2563eb;border-radius:9px;background:#0f172a;color:#f8fafc;padding:11px 13px;box-shadow:0 14px 35px #02061788;font-size:12px;line-height:1.4}
      .pt-toast.success{border-left-color:#16a34a}.pt-toast.error{border-left-color:#dc2626}.pt-toast.warn{border-left-color:#f59e0b}
      .pt-toast strong{display:block;margin-bottom:2px}.pt-toast button{float:right;margin-left:10px;background:transparent;border:0;color:#cbd5e1;font-size:16px}
      #ptSettingsButton{font-size:18px;line-height:1;padding:6px 9px;margin-left:6px}
      .pt-suite-modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#020617b8;z-index:15000;padding:20px}
      .pt-suite-modal.open{display:flex}.pt-suite-dialog{width:min(980px,96vw);max-height:94vh;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--bg-panel);box-shadow:0 20px 60px #020617aa}
      .pt-suite-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--border)}
      .pt-suite-head h2{margin:0;font-size:18px}.pt-suite-body{padding:15px}.pt-suite-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 15px;border-top:1px solid var(--border)}
      .pt-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pt-setting-card{border:1px solid var(--border);border-radius:9px;padding:12px;background:var(--bg-input)}
      .pt-setting-card.full{grid-column:1/-1}.pt-setting-card h3{margin:0 0 9px;font-size:14px}.pt-setting-card label{display:block;font-size:11px;color:var(--text-dim);font-weight:700;margin:7px 0 4px}
      .pt-rate-grid{display:grid;grid-template-columns:minmax(120px,1.2fr) repeat(3,minmax(90px,1fr));gap:6px;align-items:center}.pt-rate-grid .head{font-size:10px;color:var(--text-dim);font-weight:800;text-transform:uppercase}
      .pt-logo-preview{height:74px;display:flex;align-items:center;gap:10px}.pt-logo-preview img{max-width:220px;max-height:68px;object-fit:contain;background:#fff;border-radius:5px;padding:4px}
      .pt-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 18px}.pt-shortcut{display:grid;grid-template-columns:105px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)}
      .pt-key{font-family:Consolas,monospace;font-weight:800;color:#bfdbfe}.pt-help-note{font-size:11px;color:var(--text-dim);margin-top:12px}
      @media(max-width:760px){.pt-settings-grid,.pt-shortcuts{grid-template-columns:1fr}.pt-rate-grid{grid-template-columns:1fr 1fr}.pt-setting-card.full{grid-column:auto}}
    `;
    document.head.appendChild(style);
    const stack = document.createElement('div');
    stack.id = 'ptToastStack';
    document.body.appendChild(stack);
  }

  function toast(message, options = {}) {
    installToast();
    const node = document.createElement('div');
    node.className = `pt-toast ${options.type || 'info'}`;
    node.innerHTML = `<button type="button" aria-label="Dismiss">×</button>${options.title ? `<strong>${esc(options.title)}</strong>` : ''}<div>${esc(message)}</div>`;
    node.querySelector('button').onclick = () => node.remove();
    document.getElementById('ptToastStack').appendChild(node);
    const timeout = Number(options.timeout ?? (options.type === 'error' ? 9000 : 4500));
    if (timeout > 0) setTimeout(() => node.remove(), timeout);
    return node;
  }

  function applyModelDefaults(settings = cache) {
    const M = window.PTModels;
    if (!M) return;
    M.DEFAULT_WASTE_PCT = settings.defaultWastePct;
    M.DEFAULT_PAINTING_RATES ||= {};
    for (const key of RATE_KEYS) {
      const prior = M.DEFAULT_PAINTING_RATES[key] || {};
      M.DEFAULT_PAINTING_RATES[key] = { ...prior, ...settings.rates[key] };
    }
  }

  async function applyToCurrentJob() {
    const project = activeProject();
    const M = window.PTModels;
    const S = window.PTStore;
    if (!project || !M || !S || !appState) return false;
    project.paintingSettings ||= {};
    project.paintingSettings.wastePct = cache.defaultWastePct;
    project.paintingSettings.rates ||= {};
    for (const key of RATE_KEYS) {
      project.paintingSettings.rates[key] = {
        ...(project.paintingSettings.rates[key] || {}),
        ...cache.rates[key],
      };
    }
    for (const condition of project.conditions || []) M.applyDefaultPaintingRate?.(project, condition);
    S.touchProject?.(project);
    await S.saveState(appState);
    return true;
  }

  async function loadSettings(force = false) {
    if (loadingPromise && !force) return loadingPromise;
    loadingPromise = (async () => {
      try {
        const response = await fetch('/api/suite/settings');
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.detail || data.error || response.statusText);
        cache = normalize(data.settings);
        applyModelDefaults(cache);
        window.dispatchEvent(new CustomEvent('pt:settings-loaded', { detail: clone(cache) }));
      } catch (error) {
        cache = normalize(cache);
        applyModelDefaults(cache);
        toast(`Using built-in settings because saved settings could not be loaded: ${error.message || error}`, { type: 'warn', title: 'Settings' });
      }
      return clone(cache);
    })();
    return loadingPromise;
  }

  async function saveSettings(settings, applyCurrent) {
    const response = await fetch('/api/suite/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.detail || data.error || response.statusText || 'Could not save settings');
    cache = normalize(data.settings);
    applyModelDefaults(cache);
    if (applyCurrent) await applyToCurrentJob();
    const E = window.PTEstimates;
    if (E) {
      await E.init?.();
      try { await E.scan?.(); } catch (_) { /* user can scan later */ }
      window.dispatchEvent(new CustomEvent('pt:jobs-scan'));
    }
    window.dispatchEvent(new CustomEvent('pt:settings-saved', { detail: clone(cache) }));
    return clone(cache);
  }

  function ratesHtml() {
    return RATE_KEYS.map((key) => {
      const rate = cache.rates[key];
      return `
        <div><strong>${esc(RATE_LABELS[key])}</strong></div>
        <input type="number" min="1" step="1" data-rate="${key}" data-field="coverageRate" value="${rate.coverageRate}" />
        <input type="number" min="0" step="0.01" data-rate="${key}" data-field="material" value="${rate.material}" />
        <input type="number" min="0" step="0.01" data-rate="${key}" data-field="labor" value="${rate.labor}" />`;
    }).join('');
  }

  function installSettingsUi() {
    installToast();
    const menu = document.querySelector('.menu-bar');
    if (menu && !document.getElementById('ptSettingsButton')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'ptSettingsButton';
      button.title = 'PlanTakeoff settings';
      button.setAttribute('aria-label', 'Open settings');
      button.textContent = '⚙';
      menu.appendChild(button);
      button.onclick = openSettings;
    }

    if (!document.getElementById('ptSettingsModal')) {
      const modal = document.createElement('div');
      modal.id = 'ptSettingsModal';
      modal.className = 'pt-suite-modal';
      modal.innerHTML = `
        <section class="pt-suite-dialog" role="dialog" aria-modal="true" aria-labelledby="ptSettingsTitle">
          <header class="pt-suite-head"><h2 id="ptSettingsTitle">PlanTakeoff Settings</h2><button type="button" data-close-settings>×</button></header>
          <div class="pt-suite-body">
            <div class="pt-settings-grid">
              <section class="pt-setting-card"><h3>Estimating Defaults</h3>
                <label for="ptDefaultWaste">Default waste %</label><input id="ptDefaultWaste" type="number" min="0" max="100" step="0.5" />
                <label><input id="ptApplyCurrent" type="checkbox" checked /> Apply these defaults to the currently open job</label>
              </section>
              <section class="pt-setting-card"><h3>EST Folder Root</h3>
                <label for="ptBidsRoot">Bids root path override</label><input id="ptBidsRoot" type="text" placeholder="C:\\...\\Samuel Bids" />
                <div class="pt-help-note">The folder must already exist. Changes take effect without restarting PlanTakeoff.</div>
              </section>
              <section class="pt-setting-card full"><h3>Default Painting Rates</h3>
                <div class="pt-rate-grid"><div class="head">Category</div><div class="head">Coverage SF/gal</div><div class="head">Material $</div><div class="head">Labor $</div><div id="ptRateRows" style="display:contents"></div></div>
              </section>
              <section class="pt-setting-card full"><h3>Client Update Branding</h3>
                <label for="ptCompanyName">Company name</label><input id="ptCompanyName" type="text" />
                <label for="ptCompanyLogo">Company logo</label><input id="ptCompanyLogo" type="file" accept="image/png,image/jpeg,image/webp" />
                <div class="pt-logo-preview" id="ptLogoPreview"></div>
                <button type="button" id="ptClearLogo">Remove logo</button>
              </section>
            </div>
          </div>
          <footer class="pt-suite-footer"><button type="button" data-close-settings>Cancel</button><button type="button" class="primary" id="ptSaveSettings">Save Settings</button></footer>
        </section>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-close-settings]')) closeSettings(); });
      modal.querySelector('#ptSaveSettings').onclick = submitSettings;
      modal.querySelector('#ptCompanyLogo').onchange = chooseLogo;
      modal.querySelector('#ptClearLogo').onclick = () => { logoDraft = ''; renderLogo(); };
    }
  }

  function populateSettings() {
    const modal = document.getElementById('ptSettingsModal');
    if (!modal) return;
    modal.querySelector('#ptDefaultWaste').value = String(cache.defaultWastePct);
    modal.querySelector('#ptBidsRoot').value = cache.bidsRoot;
    modal.querySelector('#ptCompanyName').value = cache.companyName;
    modal.querySelector('#ptRateRows').innerHTML = ratesHtml();
    logoDraft = cache.companyLogo || '';
    renderLogo();
  }

  async function openSettings() {
    await loadSettings();
    installSettingsUi();
    populateSettings();
    document.getElementById('ptSettingsModal').classList.add('open');
  }
  function closeSettings() { document.getElementById('ptSettingsModal')?.classList.remove('open'); }

  function renderLogo() {
    const root = document.getElementById('ptLogoPreview');
    if (!root) return;
    root.innerHTML = logoDraft
      ? `<img src="${esc(logoDraft)}" alt="Company logo preview" /><span>Logo will appear on generated client updates.</span>`
      : '<span>No company logo selected.</span>';
  }

  function resizeLogo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error(`Could not decode ${file.name}`));
        image.onload = () => {
          const maxWidth = 700;
          const maxHeight = 240;
          const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function chooseLogo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      logoDraft = await resizeLogo(file);
      renderLogo();
    } catch (error) {
      toast(error.message || String(error), { type: 'error', title: 'Logo' });
    }
  }

  function collectSettings() {
    const rates = {};
    for (const key of RATE_KEYS) {
      rates[key] = {};
      document.querySelectorAll(`[data-rate="${key}"]`).forEach((input) => {
        rates[key][input.dataset.field] = num(input.value);
      });
    }
    return normalize({
      ...cache,
      defaultWastePct: document.getElementById('ptDefaultWaste').value,
      bidsRoot: document.getElementById('ptBidsRoot').value.trim(),
      companyName: document.getElementById('ptCompanyName').value.trim(),
      companyLogo: logoDraft,
      rates,
    });
  }

  async function submitSettings() {
    const button = document.getElementById('ptSaveSettings');
    button.disabled = true;
    try {
      const applyCurrent = document.getElementById('ptApplyCurrent').checked;
      await saveSettings(collectSettings(), applyCurrent);
      populateSettings();
      closeSettings();
      toast('Settings saved and applied.', { type: 'success', title: 'PlanTakeoff' });
    } catch (error) {
      toast(error.message || String(error), { type: 'error', title: 'Could not save settings', timeout: 0 });
    } finally {
      button.disabled = false;
    }
  }

  const SHORTCUTS = [
    ['?', 'Open this shortcut guide'], ['Esc', 'Cancel the active tool or close this guide'],
    ['V', 'Select / edit takeoff objects'], ['L', 'Linear takeoff'], ['A', 'Area takeoff'],
    ['C', 'Count takeoff'], ['R', 'Rectangle area'], ['M', 'Temporary measure'],
    ['Enter', 'Finish the active polyline / polygon'], ['Backspace', 'Remove the last draft vertex'],
    ['Delete', 'Delete selected takeoff objects'], ['Space', 'Temporarily pan the plan'],
    ['Shift', 'Hard-lock angle tracking'], ['Right-click', 'Finish a draft or pan'],
    ['Ctrl+Z', 'Undo'], ['Ctrl+Y', 'Redo'], ['Mouse wheel', 'Zoom plan'],
    ['Gear', 'Open defaults, paths, and company branding'],
  ];

  function installHelp() {
    if (document.getElementById('ptShortcutModal')) return;
    const modal = document.createElement('div');
    modal.id = 'ptShortcutModal';
    modal.className = 'pt-suite-modal';
    modal.innerHTML = `
      <section class="pt-suite-dialog" style="width:min(780px,96vw)" role="dialog" aria-modal="true" aria-labelledby="ptShortcutTitle">
        <header class="pt-suite-head"><h2 id="ptShortcutTitle">PlanTakeoff Keyboard Shortcuts</h2><button type="button" data-close-help>×</button></header>
        <div class="pt-suite-body"><div class="pt-shortcuts">${SHORTCUTS.map(([key, text]) => `<div class="pt-shortcut"><span class="pt-key">${esc(key)}</span><span>${esc(text)}</span></div>`).join('')}</div><div class="pt-help-note">Shortcuts are ignored while typing in an input, textarea, or editable field.</div></div>
        <footer class="pt-suite-footer"><button type="button" class="primary" data-close-help>Done</button></footer>
      </section>`;
    document.body.appendChild(modal);
    modal.onclick = (event) => { if (event.target === modal || event.target.closest('[data-close-help]')) closeHelp(); };
  }
  function openHelp() { installHelp(); document.getElementById('ptShortcutModal').classList.add('open'); }
  function closeHelp() { document.getElementById('ptShortcutModal')?.classList.remove('open'); }

  function installKeys() {
    if (document.documentElement.dataset.ptGlobalHelp) return;
    document.documentElement.dataset.ptGlobalHelp = '1';
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target?.matches?.('input,textarea,select,[contenteditable="true"]');
      if (event.key === 'Escape') {
        closeHelp();
        closeSettings();
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        event.stopImmediatePropagation();
        openHelp();
      }
    }, true);
  }

  window.PTToast = toast;
  window.PTSettings = {
    ready: () => loadSettings(),
    get: () => clone(cache),
    save: saveSettings,
    open: openSettings,
    applyToCurrentJob,
  };

  captureStore();
  document.addEventListener('DOMContentLoaded', () => {
    captureStore();
    installToast();
    installSettingsUi();
    installHelp();
    installKeys();
    loadSettings();
  });
})();

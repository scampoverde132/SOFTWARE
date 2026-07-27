/**
 * PlanTakeoff slim takeoff command history.
 * Supports addTakeoff/deleteTakeoff commands and keeps compatibility with
 * the app's existing add/delete entry names. Maximum: 80 commands.
 */
(function () {
  const CAP = 80;
  let undo = [];
  let redo = [];

  function clone(value) {
    try {
      return structuredClone(value);
    } catch (_) {
      return JSON.parse(JSON.stringify(value));
    }
  }

  function normalize(entry) {
    if (!entry) return null;
    const type =
      entry.type === 'add' ? 'addTakeoff' :
      entry.type === 'delete' ? 'deleteTakeoff' :
      entry.type;
    if (!['addTakeoff', 'deleteTakeoff', 'geom'].includes(type)) return null;
    return { ...clone(entry), type };
  }

  function clear() {
    undo = [];
    redo = [];
  }

  function push(entry) {
    const command = normalize(entry);
    if (!command) return;
    undo.push(command);
    if (undo.length > CAP) undo.splice(0, undo.length - CAP);
    redo = [];
  }

  function addTakeoff(objects) {
    const list = Array.isArray(objects) ? objects : [objects];
    push({ type: 'addTakeoff', objects: list.filter(Boolean) });
  }

  function deleteTakeoff(objects) {
    const list = Array.isArray(objects) ? objects : [objects];
    push({ type: 'deleteTakeoff', objects: list.filter(Boolean) });
  }

  function canUndo() {
    return undo.length > 0;
  }

  function canRedo() {
    return redo.length > 0;
  }

  function undoOnce() {
    const entry = undo.pop();
    if (!entry) return null;
    redo.push(entry);
    return clone(entry);
  }

  function redoOnce() {
    const entry = redo.pop();
    if (!entry) return null;
    undo.push(entry);
    if (undo.length > CAP) undo.splice(0, undo.length - CAP);
    return clone(entry);
  }

  window.PTHistory = {
    CAP,
    clear,
    push,
    addTakeoff,
    deleteTakeoff,
    canUndo,
    canRedo,
    undoOnce,
    redoOnce,
  };

  // Add the requested page.scaleSource model default without changing legacy
  // saved projects. Existing values are normalized when a page is used.
  const M = window.PTModels;
  if (M && typeof M.createPage === 'function') {
    const originalCreatePage = M.createPage;
    M.createPage = function createPageWithScaleSource(overrides = {}) {
      const page = originalCreatePage(overrides);
      page.scaleSource = normalizeScaleSource(
        overrides.scaleSource || page.scaleSource,
        page.calibrated
      );
      return page;
    };
  }

  function normalizeScaleSource(value, calibrated) {
    if (value === 'manual' || value === 'preset' || value === 'unverified') return value;
    if (value === 'calibrated') return 'manual';
    return calibrated ? 'manual' : value === 'preset' ? 'preset' : 'unverified';
  }

  // Complete the P0 canvas behavior after canvas-engine.js has loaded.
  function installCanvasFixes() {
    const C = window.PlanCanvas;
    if (!C || C.prototype.__p0ProfessionalMeasureFixes) return false;
    C.prototype.__p0ProfessionalMeasureFixes = true;

    const originalPointerDown = C.prototype._pointerDown;
    C.prototype._pointerDown = function professionalPointerDown(e) {
      // Right-click only finishes/cancels the current draft. It never pans.
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        if (this.draftPoints.length) this._finishDraft();
        return;
      }
      return originalPointerDown.call(this, e);
    };

    const originalSnapWorld = C.prototype._snapWorld;
    C.prototype._snapWorld = function professionalSnapWorld(world, shiftKey) {
      const ctx = this.getContext ? this.getContext() : null;
      if (ctx && ctx.page) {
        ctx.page.scaleSource = normalizeScaleSource(ctx.page.scaleSource, ctx.page.calibrated);
      }
      // Existing canvas implementation provides 4-degree soft snap and Shift hard snap.
      return originalSnapWorld.call(this, world, shiftKey);
    };

    return true;
  }

  // Room packages create several takeoffs directly in app.js. Record them as
  // one command so one Ctrl+Z removes the complete generated package.
  function installRoomPackageHistory() {
    const models = window.PTModels;
    if (!models || typeof models.buildRoomPackageTakeoffs !== 'function') return false;
    if (models.buildRoomPackageTakeoffs.__historyWrapped) return true;
    const original = models.buildRoomPackageTakeoffs;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      if (result && !result.error && Array.isArray(result.objects) && result.objects.length) {
        addTakeoff(result.objects);
      }
      return result;
    };
    wrapped.__historyWrapped = true;
    models.buildRoomPackageTakeoffs = wrapped;
    return true;
  }

  function enhanceScaleBadge() {
    const badge = document.getElementById('statusScale');
    const canvasWrap = document.querySelector('.canvas-wrap');
    if (!badge || !canvasWrap) return false;

    // Keep the scale visible in the canvas' top-right corner.
    if (badge.parentElement !== canvasWrap) canvasWrap.appendChild(badge);
    Object.assign(badge.style, {
      position: 'absolute',
      top: '10px',
      right: '10px',
      zIndex: '8',
      pointerEvents: 'none',
      boxShadow: '0 2px 8px rgba(0,0,0,.28)',
    });
    if (getComputedStyle(canvasWrap).position === 'static') canvasWrap.style.position = 'relative';

    const updateWords = () => {
      const text = badge.textContent || '';
      if (/calibrated/i.test(text)) {
        badge.textContent = text.replace(/Calibrated\s*✓?/i, 'Calibrated · verified');
        badge.dataset.scaleSource = 'manual';
      } else if (/verify|preset/i.test(text)) {
        if (!/unverified/i.test(text)) badge.textContent = `${text.replace(/\s*\(verify\)\s*/i, '')} · unverified`;
        badge.dataset.scaleSource = 'preset';
      } else {
        badge.dataset.scaleSource = 'unverified';
      }
    };
    updateWords();
    new MutationObserver(updateWords).observe(badge, { childList: true, characterData: true, subtree: true });
    return true;
  }

  function installAll() {
    installCanvasFixes();
    installRoomPackageHistory();
    enhanceScaleBadge();
  }

  document.addEventListener('DOMContentLoaded', () => {
    installAll();
    // app.js initializes the canvas asynchronously; retry briefly without affecting launch.
    let tries = 0;
    const timer = setInterval(() => {
      installAll();
      tries += 1;
      if (tries >= 40 || (window.PlanCanvas && document.getElementById('statusScale'))) {
        clearInterval(timer);
      }
    }, 100);
  });
})();

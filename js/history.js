/**
 * PlanTakeoff professional measuring enhancements + slim command history.
 *
 * Loaded before canvas-engine.js/app.js. It preserves the existing controller
 * contract while adding the remaining high-value OST-style measuring behavior.
 */
(function () {
  const CAP = 80;
  let undo = [];
  let redo = [];
  let activeCanvas = null;
  let suppressNextGeomPush = false;

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

    if (type === 'geom') {
      if (suppressNextGeomPush) {
        suppressNextGeomPush = false;
        return null;
      }
      return { ...clone(entry), type };
    }

    if (type === 'props') {
      const items = (entry.items || [])
        .filter((item) => item && item.target)
        .map((item) => ({
          target: item.target,
          id: item.target.id,
          prev: clone(item.prev || {}),
          next: clone(item.next || {}),
        }));
      return items.length ? { type, items } : null;
    }

    if (!['addTakeoff', 'deleteTakeoff'].includes(type)) return null;
    return { ...clone(entry), type };
  }

  // app.js currently applies add/delete/geom entries. Property commands mutate
  // their targets here, then return a no-op geom entry so app.js persists and redraws.
  function forApp(entry) {
    if (!entry) return null;
    if (entry.type === 'props') {
      const first = entry.items[0];
      const target = first ? resolvePropertyTarget(first) : null;
      const points = (target?.geometry?.points || []).map((p) => ({ x: p.x, y: p.y }));
      return {
        type: 'geom',
        id: first?.id,
        prevPoints: points,
        points,
      };
    }
    const copy = clone(entry);
    if (copy.type === 'addTakeoff') copy.type = 'add';
    if (copy.type === 'deleteTakeoff') copy.type = 'delete';
    return copy;
  }

  function resolvePropertyTarget(item) {
    const project = activeCanvas?.getContext ? activeCanvas.getContext()?.project : null;
    const current = project?.takeoffs?.find((takeoff) => takeoff.id === item.id);
    if (current) item.target = current;
    return current || item.target || null;
  }

  function applyPropertyCommand(entry, direction) {
    if (!entry || entry.type !== 'props') return;
    const key = direction === 'undo' ? 'prev' : 'next';
    for (const item of entry.items) {
      const target = resolvePropertyTarget(item);
      if (target) Object.assign(target, clone(item[key] || {}));
    }
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

  function recordProps(items) {
    push({ type: 'props', items: Array.isArray(items) ? items : [items] });
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
    if (entry.type === 'props') applyPropertyCommand(entry, 'undo');
    redo.push(entry);
    return forApp(entry);
  }

  function redoOnce() {
    const entry = redo.pop();
    if (!entry) return null;
    if (entry.type === 'props') applyPropertyCommand(entry, 'redo');
    undo.push(entry);
    if (undo.length > CAP) undo.splice(0, undo.length - CAP);
    return forApp(entry);
  }

  window.PTHistory = {
    CAP,
    clear,
    push,
    addTakeoff,
    deleteTakeoff,
    recordProps,
    canUndo,
    canRedo,
    undoOnce,
    redoOnce,
  };

  function normalizeScaleSource(value, calibrated) {
    if (value === 'manual' || value === 'preset' || value === 'unverified') return value;
    if (value === 'calibrated') return 'manual';
    return calibrated ? 'manual' : value === 'preset' ? 'preset' : 'unverified';
  }

  function normalizeTakeoffFlags(project) {
    for (const takeoff of project?.takeoffs || []) {
      if (takeoff.isDeduct && !takeoff.isDeduction) takeoff.isDeduction = true;
      if (takeoff.isDeduction && takeoff.isDeduct == null) takeoff.isDeduct = true;
    }
  }

  function installModelEnhancements() {
    const M = window.PTModels;
    if (!M || M.__professionalMeasureModelsV2) return !!M;
    M.__professionalMeasureModelsV2 = true;

    if (typeof M.createPage === 'function') {
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

    if (typeof M.createTakeoffObject === 'function') {
      const originalCreateTakeoff = M.createTakeoffObject;
      M.createTakeoffObject = function createTakeoffWithDeduct(...args) {
        const obj = originalCreateTakeoff.apply(this, args);
        const overrides = args[3] || {};
        const deduct = overrides.isDeduct ?? overrides.isDeduction ?? obj.isDeduction ?? false;
        obj.isDeduct = !!deduct;
        if (obj.isDeduct) obj.isDeduction = true;
        return obj;
      };
    }

    // Public computeObjectQuantity explicitly supports the requested isDeduct flag.
    // Toggled objects also mirror isDeduction so internal aggregate/estimate helpers
    // that close over the original function retain correct negative quantities.
    if (typeof M.computeObjectQuantity === 'function') {
      const originalCompute = M.computeObjectQuantity;
      M.computeObjectQuantity = function computeObjectQuantityWithDeduct(obj, condition, page) {
        const normalized = obj?.isDeduct && !obj.isDeduction
          ? { ...obj, isDeduction: true }
          : obj;
        return originalCompute(normalized, condition, page);
      };
    }

    return true;
  }

  function nearestTakeoffVertex(canvas, world, maxScreenPx) {
    const ctx = canvas.getContext ? canvas.getContext() : null;
    if (!ctx?.page) return null;
    normalizeTakeoffFlags(ctx.project);
    const maxWorld = maxScreenPx / Math.max(canvas.view.scale || 1, 0.0001);
    let best = null;
    for (const takeoff of ctx.takeoffs || ctx.project?.takeoffs || []) {
      if (takeoff.pageId !== ctx.page.id) continue;
      const points = takeoff.geometry?.points || [];
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const distance = window.PTModels.distancePx(world, point);
        if (distance <= maxWorld && (!best || distance < best.distance)) {
          best = {
            x: point.x,
            y: point.y,
            distance,
            takeoffId: takeoff.id,
            vertexIndex: i,
          };
        }
      }
    }
    return best;
  }

  function isTypingTarget(target) {
    if (!target) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
  }

  function installCanvasEnhancements() {
    const C = window.PlanCanvas;
    if (!C || C.prototype.__professionalMeasureFixesV2) return false;
    C.prototype.__professionalMeasureFixesV2 = true;

    const originalIsDigitizeTool = C.prototype.isDigitizeTool;
    C.prototype.isDigitizeTool = function professionalIsDigitizeTool() {
      return this.tool === 'rect' || originalIsDigitizeTool.call(this);
    };

    const originalSetTool = C.prototype.setTool;
    C.prototype.setTool = function professionalSetTool(tool) {
      activeCanvas = this;
      this.endpointSnap = null;
      const result = originalSetTool.call(this, tool);
      if (tool === 'rect') {
        setTimeout(() => {
          const hint = document.getElementById('takeoffHint');
          if (hint && this.tool === 'rect') {
            hint.textContent = 'Rectangle Area: click two opposite corners. Endpoint snap is active within 12 px. Esc cancels.';
          }
        }, 0);
      }
      return result;
    };

    const originalKeyDown = C.prototype._keyDown;
    C.prototype._keyDown = function professionalKeyDown(e) {
      activeCanvas = this;
      if (!isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (this.onToolRequest) this.onToolRequest('rect');
        return;
      }
      return originalKeyDown.call(this, e);
    };

    const originalSnapWorld = C.prototype._snapWorld;
    C.prototype._snapWorld = function professionalSnapWorld(world, shiftKey) {
      activeCanvas = this;
      const ctx = this.getContext ? this.getContext() : null;
      if (ctx?.page) {
        ctx.page.scaleSource = normalizeScaleSource(ctx.page.scaleSource, ctx.page.calibrated);
        normalizeTakeoffFlags(ctx.project);
      }

      const anglePoint = originalSnapWorld.call(this, world, shiftKey);
      this.endpointSnap = null;
      const snapTools = ['linear', 'area', 'rect', 'room', 'deduct', 'calibrate', 'measure'];
      if (!snapTools.includes(this.tool)) return anglePoint;

      // Shift hard-lock must remain mathematically exact; endpoint snap never
      // overrides it unless the user releases Shift.
      if (shiftKey || this.shiftDown) return anglePoint;

      const nearest = nearestTakeoffVertex(this, world, 12);
      if (!nearest) return anglePoint;
      this.endpointSnap = nearest;
      this.angleLockDeg = null;
      return { x: nearest.x, y: nearest.y };
    };

    const originalPointerDown = C.prototype._pointerDown;
    C.prototype._pointerDown = function professionalPointerDown(e) {
      activeCanvas = this;

      // Prompt 1 behavior: right-click only finishes/cancels the current draft.
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        if (this.draftPoints.length) this._finishDraft();
        this.endpointSnap = null;
        return;
      }

      if (this.tool !== 'rect' || e.button !== 0 || this.spaceDown) {
        return originalPointerDown.call(this, e);
      }

      const pos = this._eventPos(e);
      const rawWorld = this.screenToWorld(pos.x, pos.y);
      const world = this._snapWorld(rawWorld, e.shiftKey);
      const ctx = this.getContext ? this.getContext() : null;

      if (!ctx?.project || !ctx?.page) {
        this.onChange({ type: 'status-msg', message: 'Open a page and plan before drawing a rectangle.' });
        return;
      }
      if (!ctx.condition || ctx.condition.style !== 'area') {
        this.onChange({ type: 'status-msg', message: 'Select an Area condition, then use Rectangle Area.' });
        return;
      }

      if (!this.draftPoints.length) {
        this.draftPoints = [{ x: world.x, y: world.y }];
        this.draw();
        this._emitStatus(world);
        return;
      }

      const a = this.draftPoints[0];
      const b = { x: world.x, y: world.y };
      const widthScreen = Math.abs(b.x - a.x) * this.view.scale;
      const heightScreen = Math.abs(b.y - a.y) * this.view.scale;
      if (widthScreen < 2 || heightScreen < 2) {
        this.onChange({ type: 'status-msg', message: 'Rectangle needs two different opposite corners.' });
        return;
      }

      const points = [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ];
      const object = window.PTModels.createTakeoffObject(
        ctx.condition.id,
        'polygon',
        { points },
        { pageId: ctx.page.id }
      );
      this.onChange({ type: 'add-takeoff', object });
      this.draftPoints = [];
      this.lockedHover = null;
      this.endpointSnap = null;
      this.angleLockDeg = null;
      this.draw();
      this.onChange({
        type: 'digitize-continue',
        tool: 'rect',
        conditionId: ctx.condition.id,
      });
    };

    const originalDraw = C.prototype.draw;
    C.prototype.draw = function professionalDraw() {
      activeCanvas = this;
      const ctx = this.getContext ? this.getContext() : null;
      normalizeTakeoffFlags(ctx?.project);
      const result = originalDraw.call(this);
      drawProfessionalOverlay(this);
      syncDeductToggle();
      return result;
    };

    return true;
  }

  function overlayContext(canvas) {
    const ctx = canvas.ctx;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawProfessionalOverlay(canvas) {
    if (!canvas?.ctx) return;
    const appCtx = canvas.getContext ? canvas.getContext() : null;
    const ctx = overlayContext(canvas);

    // Rectangle preview from first corner to current cursor.
    if (canvas.tool === 'rect' && canvas.draftPoints.length === 1 && (canvas.lockedHover || canvas.hover)) {
      const a = canvas.worldToScreen(canvas.draftPoints[0].x, canvas.draftPoints[0].y);
      const tipWorld = canvas.endpointSnap || canvas.lockedHover || canvas.hover;
      const b = canvas.worldToScreen(tipWorld.x, tipWorld.y);
      const left = Math.min(a.x, b.x);
      const top = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      ctx.save();
      ctx.strokeStyle = appCtx?.condition?.color || '#00d4ff';
      ctx.fillStyle = appCtx?.condition?.color || '#00d4ff';
      ctx.globalAlpha = 0.18;
      ctx.fillRect(left, top, width, height);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(left, top, width, height);
      ctx.restore();
    }

    // Endpoint snap target indicator.
    if (canvas.endpointSnap && canvas.hover) {
      const p = canvas.worldToScreen(canvas.endpointSnap.x, canvas.endpointSnap.y);
      ctx.save();
      ctx.strokeStyle = '#4ade80';
      ctx.fillStyle = 'rgba(74, 222, 128, 0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 11, p.y);
      ctx.lineTo(p.x + 11, p.y);
      ctx.moveTo(p.x, p.y - 11);
      ctx.lineTo(p.x, p.y + 11);
      ctx.stroke();
      ctx.restore();
    }

    drawCursorDimensionChip(canvas, appCtx, ctx);
    ctx.restore();
  }

  function drawCursorDimensionChip(canvas, appCtx, ctx) {
    const tipWorld = canvas.endpointSnap || canvas.lockedHover || canvas.hover;
    const fpp = appCtx?.page?.feetPerPixel;
    if (!tipWorld || !fpp || !canvas.draftPoints.length) return;
    if (!['linear', 'area', 'rect'].includes(canvas.tool)) return;

    const M = window.PTModels;
    let text = '';
    if (canvas.tool === 'linear') {
      const points = [...canvas.draftPoints, tipWorld];
      const feet = M.polylineLengthPx(points) * fpp;
      text = M.ftIn ? M.ftIn(feet) : `${M.formatQty(feet, 2)} ft`;
    } else if (canvas.tool === 'rect') {
      const a = canvas.draftPoints[0];
      const area = Math.abs((tipWorld.x - a.x) * (tipWorld.y - a.y)) * fpp * fpp;
      text = `${M.formatQty(area, 1)} SF`;
    } else {
      const points = [...canvas.draftPoints, tipWorld];
      if (points.length < 3) return;
      const area = M.polygonAreaPx(points) * fpp * fpp;
      text = `${M.formatQty(area, 1)} SF`;
    }

    if (canvas.endpointSnap) text += ' · SNAP';
    const cursor = canvas.worldToScreen(tipWorld.x, tipWorld.y);
    ctx.save();
    ctx.font = '600 12px Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    const paddingX = 8;
    const height = 26;
    const width = Math.ceil(ctx.measureText(text).width) + paddingX * 2;
    let x = cursor.x + 14;
    let y = cursor.y - height - 12;
    const maxW = canvas.cssW || canvas.canvas.clientWidth;
    if (x + width > maxW - 8) x = cursor.x - width - 14;
    if (y < 8) y = cursor.y + 14;
    roundedRect(ctx, x, y, width, height, 6);
    ctx.fillStyle = 'rgba(18, 18, 22, 0.92)';
    ctx.fill();
    ctx.strokeStyle = canvas.endpointSnap ? '#4ade80' : '#5b8cff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + paddingX, y + height / 2);
    ctx.restore();
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

  function enhanceToolbar() {
    const toolbar = document.getElementById('takeoffToolbar');
    const areaButton = toolbar?.querySelector('[data-tool="area"]');
    if (!toolbar || !areaButton) return false;
    if (!toolbar.querySelector('[data-tool="rect"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tool = 'rect';
      button.textContent = 'Rectangle';
      button.title = 'Rectangle Area (R) — click two opposite corners';
      areaButton.insertAdjacentElement('afterend', button);
    }

    const panButton = toolbar.querySelector('[data-tool="pan"]');
    if (panButton) panButton.title = 'Pan — hold Space or use middle mouse';
    return true;
  }

  function enhanceDeductToggle() {
    const bar = document.getElementById('markPropsBar');
    if (!bar) return false;
    if (!document.getElementById('markDeductToggle')) {
      const row = bar.querySelector('.mark-props-row:last-of-type') || bar.querySelector('.mark-props-row');
      const label = document.createElement('label');
      label.className = 'small';
      label.title = 'Negative takeoff — subtract this object from its condition quantity';
      label.innerHTML = '<input type="checkbox" id="markDeductToggle" /> Deduct';
      row?.insertBefore(label, row.firstChild);
      const checkbox = label.querySelector('input');
      checkbox.addEventListener('change', () => toggleSelectedDeduct(checkbox.checked));
    }

    const canvasEl = document.getElementById('planCanvas');
    if (canvasEl && !canvasEl.dataset.deductSyncBound) {
      canvasEl.dataset.deductSyncBound = '1';
      canvasEl.addEventListener('mouseup', () => setTimeout(syncDeductToggle, 0));
    }
    return true;
  }

  function selectedTakeoffs() {
    const canvas = activeCanvas;
    const ctx = canvas?.getContext ? canvas.getContext() : null;
    if (!canvas || !ctx?.project) return [];
    const ids = canvas.selectedIds || new Set();
    return (ctx.project.takeoffs || []).filter((takeoff) => ids.has(takeoff.id));
  }

  function syncDeductToggle() {
    const checkbox = document.getElementById('markDeductToggle');
    if (!checkbox) return;
    const selected = selectedTakeoffs();
    checkbox.disabled = !selected.length;
    if (!selected.length) {
      checkbox.checked = false;
      checkbox.indeterminate = false;
      return;
    }
    const values = selected.map((takeoff) => !!(takeoff.isDeduct || takeoff.isDeduction));
    checkbox.checked = values.every(Boolean);
    checkbox.indeterminate = values.some(Boolean) && !values.every(Boolean);
  }

  function toggleSelectedDeduct(on) {
    const canvas = activeCanvas;
    const selected = selectedTakeoffs();
    if (!canvas || !selected.length) return;

    const items = selected.map((target) => ({
      target,
      prev: {
        isDeduct: !!target.isDeduct,
        isDeduction: !!target.isDeduction,
      },
      next: {
        isDeduct: !!on,
        isDeduction: !!on,
      },
    }));
    recordProps(items);
    for (const item of items) Object.assign(item.target, item.next);

    // Reuse app.js update handling for persistence/redraw without creating a
    // duplicate geometry command in the history stack.
    const first = selected[0];
    const points = (first.geometry?.points || []).map((p) => ({ x: p.x, y: p.y }));
    suppressNextGeomPush = true;
    setTimeout(() => {
      suppressNextGeomPush = false;
    }, 100);
    canvas.onChange({
      type: 'update-takeoff',
      id: first.id,
      prevPoints: points,
      points,
    });
    canvas.onChange({
      type: 'status-msg',
      message: `${selected.length} takeoff${selected.length === 1 ? '' : 's'} ${on ? 'set to Deduct' : 'returned to positive'}.`,
    });
    canvas.draw();
    syncDeductToggle();
  }

  function enhanceScaleBadge() {
    const badge = document.getElementById('statusScale');
    const canvasWrap = document.querySelector('.canvas-wrap');
    if (!badge || !canvasWrap) return false;

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

    if (!badge.__scaleObserver) {
      let updating = false;
      const updateWords = () => {
        if (updating) return;
        const text = badge.textContent || '';
        let next = text;
        let source = 'unverified';
        if (/calibrated/i.test(text)) {
          source = 'manual';
          if (!/verified/i.test(text)) next = text.replace(/Calibrated\s*✓?/i, 'Calibrated · verified');
        } else if (/verify|preset|scale:/i.test(text) && !/Scale:\s*—/.test(text)) {
          source = 'preset';
          if (!/unverified/i.test(text)) next = `${text.replace(/\s*\(verify\)\s*/i, '')} · unverified`;
        }
        badge.dataset.scaleSource = source;
        if (next !== text) {
          updating = true;
          badge.textContent = next;
          updating = false;
        }
      };
      updateWords();
      badge.__scaleObserver = new MutationObserver(updateWords);
      badge.__scaleObserver.observe(badge, { childList: true, characterData: true, subtree: true });
    }
    return true;
  }

  function installAll() {
    installModelEnhancements();
    installCanvasEnhancements();
    installRoomPackageHistory();
    enhanceToolbar();
    enhanceDeductToggle();
    enhanceScaleBadge();
  }

  document.addEventListener('DOMContentLoaded', () => {
    // This listener is registered before app.js, so the Rectangle button exists
    // when app.js binds its generic [data-tool] toolbar handlers.
    installAll();
    let tries = 0;
    const timer = setInterval(() => {
      installAll();
      tries += 1;
      if (
        tries >= 50 ||
        (window.PlanCanvas &&
          document.getElementById('markDeductToggle') &&
          document.querySelector('[data-tool="rect"]'))
      ) {
        clearInterval(timer);
      }
    }, 100);
  });
})();

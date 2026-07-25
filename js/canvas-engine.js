/**
 * Plan canvas: pan/zoom, takeoff drawing, mark edit (move / vertex drag).
 * Right-click = hand pan. Select tool = move whole mark or drag grips.
 */

class PlanCanvas {
  constructor(canvasEl, opts = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.onChange = opts.onChange || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.onToolRequest = opts.onToolRequest || null;
    this.getContext = opts.getContext || (() => ({}));

    this.view = { x: 0, y: 0, scale: 1 };
    this.image = null;
    this.imageUrl = null;

    this.tool = 'select';
    this.draftPoints = [];
    this.isPanning = false;
    this.panStart = null;
    this.viewStart = null;
    this.hover = null;
    this.lockedHover = null;
    this.angleLockDeg = null;
    this.selectedIds = new Set();
    this.spaceDown = false;
    this.shiftDown = false;
    this.angleLockOn = true;
    this.linearMode = 'segment';
    this.dimInactive = true;
    this.closeSnapPx = 14;
    /** When true, draw LF/SF labels on completed marks */
    this.showSegmentLabels = true;
    this.showObjectTotals = true;
    /**
     * Edit sub-mode while Select tool is active:
     * null | 'insert' (click edge to add vertex) | 'append' (click to add end vertex)
     */
    this.editMode = null;
    this.selectedVertexIndex = -1;
    /** @type {null | { mode:'vertex'|'move', id:string, vertexIndex:number, startWorld:{x,y}, origPoints:{x,y}[] }} */
    this.editDrag = null;

    this._bind();
    this.resize();
  }

  isDigitizeTool() {
    return ['linear', 'area', 'count', 'room', 'deduct'].includes(this.tool);
  }

  setLinearMode(mode) {
    this.linearMode = mode === 'polyline' ? 'polyline' : 'segment';
    this.draftPoints = [];
    this.draw();
  }

  static _isTypingTarget(el) {
    if (!el || el === document.body) return false;
    const t = el.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => this._pointerDown(e));
    c.addEventListener('mousemove', (e) => this._pointerMove(e));
    c.addEventListener('mouseup', (e) => this._pointerUp(e));
    c.addEventListener('mouseleave', () => {
      if (this.editDrag) this._endEditDrag(true);
      this.isPanning = false;
      this.hover = null;
      this.lockedHover = null;
      this.draw();
    });
    c.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => this._dblClick(e));
    // Right-click is hand-pan — never open browser menu
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this._keyDown(e));
    window.addEventListener('keyup', (e) => this._keyUp(e));
    window.addEventListener('blur', () => {
      this.spaceDown = false;
      this.shiftDown = false;
      this.isPanning = false;
      if (this.editDrag) this._endEditDrag(true);
    });
    window.addEventListener('resize', () => this.resize());
  }

  _keyDown(e) {
    if (PlanCanvas._isTypingTarget(e.target)) return;

    if (e.key === 'Shift') this.shiftDown = true;

    // Space: finish active mark if drawing; otherwise hold-to-pan
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.draftPoints.length >= 2 || (this.tool === 'area' && this.draftPoints.length >= 3)) {
        this._finishDraft();
        return;
      }
      if (this.draftPoints.length === 1) {
        // one point only — cancel dangling point rather than pan confusion
        this.draftPoints = [];
        this.draw();
        this.onChange({ type: 'status-msg', message: 'Mark cancelled (need 2+ points). Space again to pan.' });
        return;
      }
      this.spaceDown = true;
      return;
    }

    if (e.key === 'Escape') {
      this.draftPoints = [];
      this.lockedHover = null;
      this.angleLockDeg = null;
      this.editDrag = null;
      if (this.editMode) {
        this.editMode = null;
        this.onChange({ type: 'edit-mode', mode: null });
      }
      this.draw();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      this._finishDraft();
      return;
    }

    // Backspace: pop last draft vertex first; else delete selection
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.draftPoints.length) {
        e.preventDefault();
        this.draftPoints.pop();
        this.draw();
        this._emitStatus(this.hover);
        return;
      }
      if (this.selectedIds.size && e.key !== 'Backspace') {
        // Delete removes selection; Backspace only pops draft (when empty, allow Delete only for selection)
      }
      if (this.selectedIds.size && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        this._deleteSelected();
        return;
      }
    }

    // Ctrl+Z mid-draft: pop vertex only (stop app-level object undo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (this.draftPoints.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.draftPoints.pop();
        this.draw();
        this._emitStatus(this.hover);
        return;
      }
    }

    // Edit-mode hotkeys (selected mark)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && this.selectedIds.size) {
      const k = e.key.toLowerCase();
      if (k === 'i') {
        e.preventDefault();
        this.setEditMode(this.editMode === 'insert' ? null : 'insert');
        this.onChange({
          type: 'status-msg',
          message:
            this.editMode === 'insert'
              ? 'Insert points: click on an edge of the selected mark to add a vertex.'
              : 'Insert mode off.',
        });
        return;
      }
      if (k === 'n') {
        e.preventDefault();
        this.setEditMode(this.editMode === 'append' ? null : 'append');
        this.onChange({
          type: 'status-msg',
          message:
            this.editMode === 'append'
              ? 'Add points: click to append a vertex (extend area / run). Enter or Esc to finish.'
              : 'Add-points mode off.',
        });
        return;
      }
      if (k === 'x' && this.selectedVertexIndex >= 0) {
        e.preventDefault();
        this._deleteSelectedVertex();
        return;
      }
    }

    // Tool hotkeys when not chorded
    if (!e.ctrlKey && !e.metaKey && !e.altKey && this.onToolRequest) {
      const k = e.key.toLowerCase();
      const map = {
        v: 'select',
        l: 'linear',
        a: 'area',
        c: 'count',
        m: 'measure',
        p: 'pan',
      };
      if (map[k]) {
        e.preventDefault();
        this.onToolRequest(map[k]);
      }
    }
  }

  setEditMode(mode) {
    this.editMode = mode || null;
    if (this.editMode) {
      this.tool = 'select';
      this.canvas.style.cursor = 'crosshair';
    }
    this.draw();
    this.onChange({ type: 'edit-mode', mode: this.editMode });
  }

  setShowSegmentLabels(on) {
    this.showSegmentLabels = !!on;
    this.draw();
  }

  setShowObjectTotals(on) {
    this.showObjectTotals = !!on;
    this.draw();
  }

  _keyUp(e) {
    if (e.code === 'Space') this.spaceDown = false;
    if (e.key === 'Shift') this.shiftDown = false;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w;
    this.cssH = h;
    this.draw();
  }

  setTool(tool) {
    this.tool = tool;
    this.draftPoints = [];
    this.lockedHover = null;
    this.angleLockDeg = null;
    this.canvas.style.cursor =
      tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    this.draw();
    this.onChange({ type: 'tool-changed', tool });
  }

  async loadImage(dataUrl) {
    if (!dataUrl) {
      this.image = null;
      this.imageUrl = null;
      this.draw();
      return;
    }
    if (dataUrl === this.imageUrl && this.image) {
      this.draw();
      return;
    }
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });
    this.image = img;
    this.imageUrl = dataUrl;
    this.fitToView();
    this.draw();
  }

  fitToView() {
    if (!this.image || !this.cssW) return;
    const pad = 40;
    const sx = (this.cssW - pad * 2) / this.image.width;
    const sy = (this.cssH - pad * 2) / this.image.height;
    this.view.scale = Math.min(sx, sy, 2);
    this.view.x = (this.cssW - this.image.width * this.view.scale) / 2;
    this.view.y = (this.cssH - this.image.height * this.view.scale) / 2;
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.view.x) / this.view.scale,
      y: (sy - this.view.y) / this.view.scale,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.view.scale + this.view.x,
      y: wy * this.view.scale + this.view.y,
    };
  }

  _eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _wheel(e) {
    e.preventDefault();
    const pos = this._eventPos(e);
    const before = this.screenToWorld(pos.x, pos.y);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.view.scale = Math.min(20, Math.max(0.05, this.view.scale * factor));
    this.view.x = pos.x - before.x * this.view.scale;
    this.view.y = pos.y - before.y * this.view.scale;
    this._emitStatus();
    this.draw();
  }

  /** Apply 45° angle lock when drafting (OpenTakeoff angleSnap). */
  _snapWorld(world, shiftKey) {
    const drawTools = ['linear', 'area', 'calibrate', 'measure'];
    if (!this.angleLockOn || !drawTools.includes(this.tool) || !this.draftPoints.length) {
      this.angleLockDeg = null;
      return world;
    }
    const last = this.draftPoints[this.draftPoints.length - 1];
    const minPx = 12 / this.view.scale;
    if (window.PTModels.distancePx(last, world) < minPx) {
      this.angleLockDeg = null;
      return world;
    }
    const force = !!(shiftKey || this.shiftDown);
    const lock = window.PTModels.angleSnap(last, world, force);
    if (!lock) {
      this.angleLockDeg = null;
      return world;
    }
    this.angleLockDeg = lock.deg;
    return lock.pt;
  }

  _pointerDown(e) {
    const pos = this._eventPos(e);
    const rawWorld = this.screenToWorld(pos.x, pos.y);

    // Right-click: finish mark if drawing, otherwise hand-pan the plan
    if (e.button === 2) {
      e.preventDefault();
      if (this.draftPoints.length >= 2 || (this.tool === 'area' && this.draftPoints.length >= 3)) {
        this._finishDraft();
        return;
      }
      if (this.draftPoints.length) {
        this.draftPoints = [];
        this.draw();
        return;
      }
      this.isPanning = true;
      this.panStart = pos;
      this.viewStart = { ...this.view };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // Hand pan: middle-click, Pan tool, or Space (when not finishing a mark)
    if (e.button === 1 || this.tool === 'pan' || this.spaceDown) {
      e.preventDefault();
      this.isPanning = true;
      this.panStart = pos;
      this.viewStart = { ...this.view };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const world = this._snapWorld(rawWorld, e.shiftKey);

    // Select / edit marks (move whole or drag vertex grips)
    if (this.tool === 'select') {
      // Insert vertex on edge of selected mark
      if (this.editMode === 'insert' && this.selectedIds.size) {
        const id = [...this.selectedIds][0];
        if (this._insertVertexOnEdge(id, world)) {
          this.draw();
          return;
        }
        this.onChange({
          type: 'status-msg',
          message: 'Click closer to an edge of the selected mark to insert a point.',
        });
        return;
      }
      // Append vertex to selected polyline/polygon
      if (this.editMode === 'append' && this.selectedIds.size) {
        const id = [...this.selectedIds][0];
        if (this._appendVertex(id, world)) {
          this.draw();
          return;
        }
        return;
      }
      this._beginSelectOrEdit(world, e.shiftKey);
      this.draw();
      return;
    }

    // While digitizing, allow grabbing grips of selected marks with Alt
    if (e.altKey && this.selectedIds.size) {
      this._beginSelectOrEdit(world, e.shiftKey);
      if (this.editDrag) {
        this.draw();
        return;
      }
    }

    if (this.tool === 'count') {
      this._placeCount(world);
      return;
    }

    if (['linear', 'area', 'room', 'deduct', 'calibrate', 'measure'].includes(this.tool)) {
      const ctx = this.getContext();
      if (
        this.isDigitizeTool() &&
        !['room', 'deduct'].includes(this.tool) &&
        !ctx.condition
      ) {
        this.onChange({
          type: 'status-msg',
          message: 'Pick a condition in the list, then click the plan.',
        });
        return;
      }
      if (this.tool === 'deduct' && this.selectedIds.size !== 1 && !ctx.deductParentId) {
        this.onChange({
          type: 'status-msg',
          message: 'Select a parent wall/area mark first, then draw the door/window opening.',
        });
        return;
      }
      // Allow digitize even before plan image is assigned to page object
      // (page may exist without imageDataUrl yet — user still needs UI feedback)
      if (this.isDigitizeTool() && !ctx.page) {
        this.onChange({
          type: 'status-msg',
          message: 'No page open — add or select a page, then load a plan.',
        });
        return;
      }
      // Auto-align tool to condition style (skip room/deduct special tools)
      if (
        this.isDigitizeTool() &&
        ctx.condition &&
        !['room', 'deduct'].includes(this.tool)
      ) {
        const need =
          ctx.condition.style === 'area'
            ? 'area'
            : ctx.condition.style === 'count'
              ? 'count'
              : 'linear';
        if (this.tool !== need) {
          this.tool = need;
          this.canvas.style.cursor = 'crosshair';
          this.onChange({ type: 'tool-changed', tool: need });
          if (need === 'count') {
            this._placeCount(world);
            return;
          }
        }
      }

      // Area / room / deduct: click near first vertex closes the polygon
      if (
        (this.tool === 'area' || this.tool === 'room' || this.tool === 'deduct') &&
        this.draftPoints.length >= 3 &&
        this._nearFirstPoint(world)
      ) {
        this._finishDraft();
        return;
      }

      this.draftPoints.push(world);

      if (this.tool === 'calibrate' && this.draftPoints.length === 2) {
        this._finishCalibrate();
        return;
      }
      if (this.tool === 'measure' && this.draftPoints.length === 2) {
        this._showMeasure();
        this.draftPoints = [];
        this.draw();
        return;
      }
      // Linear segment mode: every 2 clicks = one takeoff (fast walls)
      if (
        this.tool === 'linear' &&
        this.linearMode === 'segment' &&
        this.draftPoints.length >= 2
      ) {
        this._finishDraft();
        return;
      }
      this.draw();
      this._emitStatus(this.lockedHover || this.hover);
    }
  }

  _nearFirstPoint(world) {
    if (!this.draftPoints.length) return false;
    const a = this.draftPoints[0];
    const dScreen = window.PTModels.distancePx(a, world) * this.view.scale;
    return dScreen <= this.closeSnapPx;
  }

  _pointerMove(e) {
    const pos = this._eventPos(e);
    const rawWorld = this.screenToWorld(pos.x, pos.y);
    this.hover = rawWorld;
    this.lockedHover = this._snapWorld(rawWorld, e.shiftKey);

    if (this.isPanning && this.panStart) {
      const dx = pos.x - this.panStart.x;
      const dy = pos.y - this.panStart.y;
      this.view.x = this.viewStart.x + dx;
      this.view.y = this.viewStart.y + dy;
      this.draw();
      return;
    }

    if (this.editDrag) {
      this._applyEditDrag(rawWorld, e.shiftKey);
      this.draw();
      return;
    }

    // Cursor feedback over grips when select tool
    if (this.tool === 'select') {
      const grip = this._hitVertexGrip(rawWorld);
      const body = grip ? null : this._hitTakeoffBody(rawWorld);
      this.canvas.style.cursor = grip ? 'pointer' : body ? 'move' : 'default';
    }

    this._emitStatus(this.lockedHover || this.hover);
    this.draw();
  }

  _pointerUp(e) {
    if (this.editDrag) {
      this._endEditDrag(true);
    }
    this.isPanning = false;
    if (this.tool === 'pan') this.canvas.style.cursor = 'grab';
    else if (this.tool === 'select') this.canvas.style.cursor = 'default';
    else this.canvas.style.cursor = 'crosshair';
  }

  _beginSelectOrEdit(world, additive) {
    // Prefer vertex grip on already-selected (or any) takeoff
    const grip = this._hitVertexGrip(world);
    if (grip) {
      if (!this.selectedIds.has(grip.id)) {
        if (!additive) this.selectedIds.clear();
        this.selectedIds.add(grip.id);
        this.onChange({ type: 'selection', ids: [...this.selectedIds], conditionId: grip.conditionId });
      }
      const t = this._takeoffById(grip.id);
      if (!t?.geometry?.points?.length) return;
      this.selectedVertexIndex = grip.vertexIndex;
      this.editDrag = {
        mode: 'vertex',
        id: grip.id,
        vertexIndex: grip.vertexIndex,
        startWorld: { ...world },
        origPoints: t.geometry.points.map((p) => ({ x: p.x, y: p.y })),
      };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const body = this._hitTakeoffBody(world);
    if (body) {
      if (!additive) this.selectedIds.clear();
      this.selectedIds.add(body.id);
      this.onChange({ type: 'selection', ids: [...this.selectedIds], conditionId: body.conditionId });
      const t = this._takeoffById(body.id);
      if (!t?.geometry?.points?.length) return;
      this.editDrag = {
        mode: 'move',
        id: body.id,
        vertexIndex: -1,
        startWorld: { ...world },
        origPoints: t.geometry.points.map((p) => ({ x: p.x, y: p.y })),
      };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // empty click — clear selection
    this._hitSelect(world, additive);
  }

  _takeoffById(id) {
    const ctx = this.getContext();
    const list = ctx.takeoffs || ctx.project?.takeoffs || [];
    return list.find((t) => t.id === id) || null;
  }

  /** Hit a vertex grip (screen-sized). Prefer selected takeoffs. */
  _hitVertexGrip(world) {
    const ctx = this.getContext();
    if (!ctx.project || !ctx.page) return null;
    const gripR = 10 / this.view.scale;
    const list = (ctx.takeoffs || []).filter((t) => t.pageId === ctx.page.id);
    // Selected first
    const ordered = [
      ...list.filter((t) => this.selectedIds.has(t.id)),
      ...list.filter((t) => !this.selectedIds.has(t.id)),
    ];
    for (const t of ordered) {
      const cond = ctx.project.conditions.find((c) => c.id === t.conditionId);
      const layer = ctx.project.layers.find((l) => l.id === cond?.layerId);
      if (layer && !layer.visible) continue;
      const pts = t.geometry?.points || [];
      for (let i = 0; i < pts.length; i++) {
        if (window.PTModels.distancePx(pts[i], world) <= gripR) {
          return { id: t.id, vertexIndex: i, conditionId: t.conditionId };
        }
      }
    }
    return null;
  }

  _hitTakeoffBody(world) {
    const ctx = this.getContext();
    if (!ctx.project || !ctx.page) return null;
    const tol = 10 / this.view.scale;
    const hits = [];
    for (const t of ctx.takeoffs || []) {
      if (t.pageId !== ctx.page.id) continue;
      const cond = ctx.project.conditions.find((c) => c.id === t.conditionId);
      const layer = ctx.project.layers.find((l) => l.id === cond?.layerId);
      if (layer && !layer.visible) continue;
      const pts = t.geometry?.points || [];
      if (!pts.length) continue;
      if (t.kind === 'point') {
        if (window.PTModels.distancePx(pts[0], world) < tol * 1.8) {
          hits.push({ id: t.id, conditionId: t.conditionId });
        }
      } else if (t.kind === 'polyline' || t.kind === 'segment') {
        for (let i = 1; i < pts.length; i++) {
          if (distToSegment(world, pts[i - 1], pts[i]) < tol) {
            hits.push({ id: t.id, conditionId: t.conditionId });
            break;
          }
        }
      } else if (t.kind === 'polygon') {
        if (pointInPolygon(world, pts)) {
          hits.push({ id: t.id, conditionId: t.conditionId });
        } else {
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length;
            if (distToSegment(world, pts[i], pts[j]) < tol) {
              hits.push({ id: t.id, conditionId: t.conditionId });
              break;
            }
          }
        }
      }
    }
    return hits.length ? hits[hits.length - 1] : null;
  }

  _applyEditDrag(world, shiftKey) {
    const drag = this.editDrag;
    if (!drag) return;
    const t = this._takeoffById(drag.id);
    if (!t?.geometry?.points) return;

    if (drag.mode === 'vertex') {
      let pt = { x: world.x, y: world.y };
      // Optional ortho from previous vertex
      if (shiftKey && drag.vertexIndex > 0) {
        const prev = drag.origPoints[drag.vertexIndex - 1];
        const lock = window.PTModels.angleSnap(prev, pt, true);
        if (lock) pt = lock.pt;
      } else if (shiftKey && drag.vertexIndex === 0 && drag.origPoints.length > 1) {
        const next = drag.origPoints[1];
        const lock = window.PTModels.angleSnap(next, pt, true);
        if (lock) pt = lock.pt;
      }
      t.geometry.points[drag.vertexIndex] = pt;
    } else if (drag.mode === 'move') {
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      t.geometry.points = drag.origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }

    // Live qty feedback
    const ctx = this.getContext();
    const cond = ctx.project?.conditions.find((c) => c.id === t.conditionId);
    const page = ctx.page;
    if (cond && page?.feetPerPixel && window.PTModels.computeObjectQuantity) {
      const q = window.PTModels.computeObjectQuantity(t, cond, page);
      this.onStatus({
        zoom: Math.round(this.view.scale * 100),
        pageLabel: page.name,
        dim: `  |  edit ${window.PTModels.formatQty(q.primary)} ${cond.unitPrimary || ''}`,
      });
    }
  }

  _endEditDrag(commit) {
    const drag = this.editDrag;
    if (!drag) return;
    const t = this._takeoffById(drag.id);
    this.editDrag = null;
    if (!t || !commit) {
      if (t && drag.origPoints) {
        t.geometry.points = drag.origPoints.map((p) => ({ x: p.x, y: p.y }));
      }
      this.draw();
      return;
    }
    // Did anything change?
    const same =
      t.geometry.points.length === drag.origPoints.length &&
      t.geometry.points.every(
        (p, i) => p.x === drag.origPoints[i].x && p.y === drag.origPoints[i].y
      );
    if (same) {
      this.draw();
      return;
    }
    this.onChange({
      type: 'update-takeoff',
      id: t.id,
      points: t.geometry.points.map((p) => ({ x: p.x, y: p.y })),
      prevPoints: drag.origPoints.map((p) => ({ x: p.x, y: p.y })),
    });
    this.draw();
  }

  _dblClick(e) {
    if (['linear', 'area', 'room', 'deduct'].includes(this.tool)) {
      this._finishDraft();
      return;
    }
    // Double-click edge of selected mark → insert vertex (fix incomplete shapes)
    if (this.tool === 'select' && this.selectedIds.size) {
      const pos = this._eventPos(e);
      const world = this.screenToWorld(pos.x, pos.y);
      const id = [...this.selectedIds][0];
      if (this._insertVertexOnEdge(id, world)) {
        this.onChange({
          type: 'status-msg',
          message: 'Vertex added — drag white grips to reshape the mark.',
        });
        this.draw();
      }
    }
  }

  /**
   * Insert a vertex on the nearest edge of takeoff `id` if within tolerance.
   */
  _insertVertexOnEdge(id, world) {
    const t = this._takeoffById(id);
    if (!t?.geometry?.points?.length || t.kind === 'point') return false;
    const pts = t.geometry.points;
    const tol = 14 / this.view.scale;
    let best = null;
    const n = pts.length;
    const isPoly = t.kind === 'polygon';
    const edgeCount = isPoly ? n : Math.max(0, n - 1);
    for (let i = 0; i < edgeCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const d = distToSegment(world, a, b);
      if (d < tol && (!best || d < best.d)) best = { i, d, a, b };
    }
    if (!best) return false;
    const prevPoints = pts.map((p) => ({ x: p.x, y: p.y }));
    const proj = projectOnSegment(world, best.a, best.b);
    pts.splice(best.i + 1, 0, { x: proj.x, y: proj.y });
    this.selectedVertexIndex = best.i + 1;
    this.onChange({
      type: 'update-takeoff',
      id,
      prevPoints,
      points: pts.map((p) => ({ x: p.x, y: p.y })),
    });
    return true;
  }

  _appendVertex(id, world) {
    const t = this._takeoffById(id);
    if (!t?.geometry?.points?.length || t.kind === 'point') return false;
    const prevPoints = t.geometry.points.map((p) => ({ x: p.x, y: p.y }));
    t.geometry.points.push({ x: world.x, y: world.y });
    if (t.kind === 'segment' && t.geometry.points.length > 2) t.kind = 'polyline';
    this.selectedVertexIndex = t.geometry.points.length - 1;
    this.onChange({
      type: 'update-takeoff',
      id,
      prevPoints,
      points: t.geometry.points.map((p) => ({ x: p.x, y: p.y })),
    });
    return true;
  }

  _deleteSelectedVertex() {
    if (this.selectedIds.size !== 1 || this.selectedVertexIndex < 0) return;
    const id = [...this.selectedIds][0];
    const t = this._takeoffById(id);
    if (!t?.geometry?.points) return;
    const pts = t.geometry.points;
    const minPts = t.kind === 'polygon' ? 3 : t.kind === 'point' ? 1 : 2;
    if (pts.length <= minPts) {
      this.onChange({
        type: 'status-msg',
        message: `Cannot remove — mark needs at least ${minPts} points.`,
      });
      return;
    }
    const prevPoints = pts.map((p) => ({ x: p.x, y: p.y }));
    pts.splice(this.selectedVertexIndex, 1);
    this.selectedVertexIndex = Math.min(this.selectedVertexIndex, pts.length - 1);
    this.onChange({
      type: 'update-takeoff',
      id,
      prevPoints,
      points: pts.map((p) => ({ x: p.x, y: p.y })),
    });
    this.draw();
  }

  /** Convert selected polyline/segment (3+ pts) into a closed area polygon. */
  convertSelectionToArea() {
    if (this.selectedIds.size !== 1) return false;
    const id = [...this.selectedIds][0];
    const t = this._takeoffById(id);
    if (!t || t.kind === 'point' || t.kind === 'polygon') return false;
    if ((t.geometry?.points?.length || 0) < 3) return false;
    const prevPoints = t.geometry.points.map((p) => ({ x: p.x, y: p.y }));
    t.kind = 'polygon';
    this.onChange({
      type: 'update-takeoff',
      id,
      prevPoints,
      points: t.geometry.points.map((p) => ({ x: p.x, y: p.y })),
      kind: 'polygon',
    });
    this.draw();
    return true;
  }

  _finishDraft() {
    const M = window.PTModels;
    const ctx = this.getContext();
    const needsCond = !['room', 'deduct'].includes(this.tool);
    if (!ctx.project || !ctx.page || (needsCond && !ctx.condition)) {
      if (this.draftPoints.length) {
        this.onChange({
          type: 'status-msg',
          message: needsCond
            ? 'Select a condition first, then draw.'
            : 'Open a page with a scaled plan first.',
        });
      }
      this.draftPoints = [];
      this.lockedHover = null;
      this.draw();
      return;
    }

    let added = false;
    if (this.tool === 'linear' && this.draftPoints.length >= 2) {
      const kind = this.linearMode === 'segment' ? 'segment' : 'polyline';
      const obj = M.createTakeoffObject(
        ctx.condition.id,
        kind,
        { points: [...this.draftPoints] },
        { pageId: ctx.page.id }
      );
      this.onChange({ type: 'add-takeoff', object: obj });
      added = true;
    } else if (this.tool === 'area' && this.draftPoints.length >= 3) {
      const obj = M.createTakeoffObject(
        ctx.condition.id,
        'polygon',
        { points: [...this.draftPoints] },
        { pageId: ctx.page.id }
      );
      this.onChange({ type: 'add-takeoff', object: obj });
      added = true;
    } else if (this.tool === 'room' && this.draftPoints.length >= 3) {
      this.onChange({
        type: 'room-package',
        points: this.draftPoints.map((p) => ({ x: p.x, y: p.y })),
        pageId: ctx.page.id,
      });
      added = true;
    } else if (this.tool === 'deduct' && this.draftPoints.length >= 3) {
      const parentId =
        this.selectedIds.size === 1
          ? [...this.selectedIds][0]
          : ctx.deductParentId || null;
      const obj = M.createTakeoffObject(
        ctx.condition?.id || ctx.project.conditions.find((c) => c.roomRole === 'opening')?.id,
        'polygon',
        { points: [...this.draftPoints] },
        {
          pageId: ctx.page.id,
          isDeduction: true,
          parentId,
          role: 'opening',
          label: 'Opening',
        }
      );
      this.onChange({ type: 'add-takeoff', object: obj });
      added = true;
    }
    // PlanSwift: stay in digitize mode with same tool/condition for the next click
    this.draftPoints = [];
    this.lockedHover = null;
    this.angleLockDeg = null;
    this.draw();
    if (added) {
      this.onChange({
        type: 'digitize-continue',
        tool: this.tool,
        conditionId: ctx.condition.id,
      });
    }
  }

  _placeCount(world) {
    const M = window.PTModels;
    const ctx = this.getContext();
    if (!ctx.project || !ctx.page || !ctx.condition) {
      this.onChange({ type: 'status-msg', message: 'Pick a Count condition in the list, then click.' });
      return;
    }
    if (ctx.condition.style !== 'count') {
      this.onChange({
        type: 'status-msg',
        message: `“${ctx.condition.name}” is ${ctx.condition.style}, not count. Select a count condition.`,
      });
      return;
    }
    const obj = M.createTakeoffObject(ctx.condition.id, 'point', { points: [world] }, {
      pageId: ctx.page.id,
    });
    this.onChange({ type: 'add-takeoff', object: obj });
    this.onChange({
      type: 'digitize-continue',
      tool: 'count',
      conditionId: ctx.condition.id,
    });
    this.draw();
  }

  _finishCalibrate() {
    const [a, b] = this.draftPoints;
    const px = window.PTModels.distancePx(a, b);
    this.draftPoints = [];
    this.lockedHover = null;
    this.draw();
    this.onChange({ type: 'calibrate', pixelDistance: px });
  }

  _showMeasure() {
    const [a, b] = this.draftPoints;
    const px = window.PTModels.distancePx(a, b);
    const ctx = this.getContext();
    const fpp = ctx.page?.feetPerPixel;
    const feet = fpp ? px * fpp : null;
    this.onChange({ type: 'measure', pixelDistance: px, feet });
  }

  _hitSelect(world, additive) {
    const ctx = this.getContext();
    if (!ctx.project) return;
    const hits = [];
    const tol = 8 / this.view.scale;

    for (const t of ctx.takeoffs || []) {
      if (t.pageId !== ctx.page?.id) continue;
      const cond = ctx.project.conditions.find((c) => c.id === t.conditionId);
      const layer = ctx.project.layers.find((l) => l.id === cond?.layerId);
      if (layer && !layer.visible) continue;

      if (t.kind === 'point') {
        const p = t.geometry.points[0];
        if (window.PTModels.distancePx(p, world) < tol * 1.5) hits.push(t.id);
      } else if (t.kind === 'polyline' || t.kind === 'segment') {
        const pts = t.geometry.points;
        for (let i = 1; i < pts.length; i++) {
          if (distToSegment(world, pts[i - 1], pts[i]) < tol) {
            hits.push(t.id);
            break;
          }
        }
      } else if (t.kind === 'polygon') {
        if (pointInPolygon(world, t.geometry.points)) hits.push(t.id);
      }
    }

    const id = hits[hits.length - 1];
    if (!additive) this.selectedIds.clear();
    if (id) {
      if (this.selectedIds.has(id) && additive) this.selectedIds.delete(id);
      else this.selectedIds.add(id);
    }
    const ids = [...this.selectedIds];
    let conditionId = null;
    if (id) {
      const t = (ctx.takeoffs || []).find((x) => x.id === id);
      conditionId = t?.conditionId || null;
    }
    this.onChange({ type: 'selection', ids, conditionId });
  }

  _deleteSelected() {
    if (!this.selectedIds.size) return;
    this.onChange({ type: 'delete-takeoffs', ids: [...this.selectedIds] });
    this.selectedIds.clear();
    this.draw();
  }

  _emitStatus(world) {
    const ctx = this.getContext();
    const zoom = Math.round(this.view.scale * 100);
    let dim = '';
    const tip = world || this.lockedHover || this.hover;
    if (this.draftPoints.length && tip && ctx.page?.feetPerPixel) {
      const pts = [...this.draftPoints, tip];
      if (this.tool === 'linear' || this.tool === 'measure' || this.tool === 'calibrate') {
        const len = window.PTModels.polylineLengthPx(pts) * ctx.page.feetPerPixel;
        dim = `  |  ${window.PTModels.formatQty(len, 2)} LF`;
        if (this.angleLockDeg != null) dim += `  ∠${this.angleLockDeg}°`;
      } else if (this.tool === 'area' && pts.length >= 3) {
        const area = window.PTModels.polygonAreaPx(pts) * ctx.page.feetPerPixel ** 2;
        dim = `  |  ${window.PTModels.formatQty(area, 2)} SF`;
        if (this.angleLockDeg != null) dim += `  ∠${this.angleLockDeg}°`;
      }
    } else if (this.angleLockDeg != null && this.draftPoints.length) {
      dim = `  |  ∠${this.angleLockDeg}° locked`;
    }
    const pageLabel = ctx.page ? `${ctx.page.name}` : 'No page';
    this.onStatus({ zoom, pageLabel, dim, world: tip, angleLock: this.angleLockDeg });
  }

  draw() {
    const ctx2 = this.ctx;
    const w = this.cssW || this.canvas.clientWidth;
    const h = this.cssH || this.canvas.clientHeight;
    ctx2.save();
    ctx2.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx2.clearRect(0, 0, w, h);

    ctx2.fillStyle = '#2a2a2e';
    ctx2.fillRect(0, 0, w, h);

    if (!this.image) {
      ctx2.fillStyle = '#3a3a40';
      ctx2.font = '14px Segoe UI, sans-serif';
      ctx2.textAlign = 'center';
      ctx2.fillText('Load a plan image (PNG/JPG) or rasterized PDF page to begin takeoff', w / 2, h / 2);
      ctx2.restore();
      return;
    }

    ctx2.save();
    ctx2.translate(this.view.x, this.view.y);
    ctx2.scale(this.view.scale, this.view.scale);

    ctx2.drawImage(this.image, 0, 0);

    const appCtx = this.getContext();
    const project = appCtx.project;
    const activeCondId = appCtx.condition?.id || null;
    if (project) {
      const pageId = appCtx.page?.id;
      // Draw inactive first (dimmed), then active condition on top
      const list = project.takeoffs.filter((t) => t.pageId === pageId);
      const drawOne = (t, forceAlpha) => {
        const cond = project.conditions.find((c) => c.id === t.conditionId);
        if (!cond) return;
        const layer = project.layers.find((l) => l.id === cond.layerId);
        if (layer && !layer.visible) return;
        const selected = this.selectedIds.has(t.id);
        const isActive = !activeCondId || t.conditionId === activeCondId;
        const dim =
          this.dimInactive && this.isDigitizeTool() && activeCondId && !isActive && !selected;
        ctx2.save();
        if (dim) ctx2.globalAlpha = forceAlpha ?? 0.22;
        else if (!isActive && this.dimInactive && activeCondId) ctx2.globalAlpha = 0.45;
        this._drawTakeoff(ctx2, t, cond, selected || (isActive && this.isDigitizeTool()));
        ctx2.restore();
      };
      for (const t of list) {
        if (activeCondId && t.conditionId === activeCondId) continue;
        drawOne(t);
      }
      for (const t of list) {
        if (activeCondId && t.conditionId !== activeCondId) continue;
        drawOne(t, 1);
      }
    }

    // draft rubber-band
    if (this.draftPoints.length) {
      const tip = this.lockedHover || this.hover;
      let pts = tip ? [...this.draftPoints, tip] : this.draftPoints;
      // Preview area close ring
      const closing =
        (this.tool === 'area' || this.tool === 'room' || this.tool === 'deduct') &&
        this.draftPoints.length >= 3 &&
        tip &&
        this._nearFirstPoint(tip);
      if (closing) pts = [...this.draftPoints]; // snap preview to close
      const color = this.angleLockDeg != null ? '#5b8cff' : appCtx.condition?.color || '#00d4ff';
      ctx2.strokeStyle = color;
      ctx2.fillStyle = color;
      ctx2.lineWidth = (this.angleLockDeg != null ? 2.8 : 2.2) / this.view.scale;
      ctx2.setLineDash([6 / this.view.scale, 4 / this.view.scale]);
      ctx2.beginPath();
      pts.forEach((p, i) => (i ? ctx2.lineTo(p.x, p.y) : ctx2.moveTo(p.x, p.y)));
      if (
        (this.tool === 'area' || this.tool === 'room' || this.tool === 'deduct') &&
        (pts.length >= 3 || closing)
      ) {
        ctx2.closePath();
        ctx2.globalAlpha = closing ? 0.28 : 0.15;
        ctx2.fill();
        ctx2.globalAlpha = 1;
      }
      ctx2.stroke();
      ctx2.setLineDash([]);
      for (const p of this.draftPoints) {
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, 4 / this.view.scale, 0, Math.PI * 2);
        ctx2.fill();
      }
      // Close target halo on first vertex for area
      if (
        (this.tool === 'area' || this.tool === 'room' || this.tool === 'deduct') &&
        this.draftPoints.length >= 3
      ) {
        const f = this.draftPoints[0];
        ctx2.beginPath();
        ctx2.arc(f.x, f.y, this.closeSnapPx / this.view.scale, 0, Math.PI * 2);
        ctx2.strokeStyle = closing ? '#4ade80' : 'rgba(255,255,255,0.5)';
        ctx2.lineWidth = 1.5 / this.view.scale;
        ctx2.stroke();
      }

      // Live dimension label
      if (pts.length >= 2 && appCtx.page?.feetPerPixel) {
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        let label = '';
        if (
          (this.tool === 'area' || this.tool === 'room' || this.tool === 'deduct') &&
          pts.length >= 3
        ) {
          const area = window.PTModels.polygonAreaPx(pts) * appCtx.page.feetPerPixel ** 2;
          label = `${window.PTModels.formatQty(area, 1)} SF`;
          if (this.tool === 'room') label = `Room ${label}`;
          if (this.tool === 'deduct') label = `Opening −${window.PTModels.formatQty(area, 1)} SF`;
          if (closing) label += ' · close';
        } else {
          const len = window.PTModels.polylineLengthPx(pts) * appCtx.page.feetPerPixel;
          label = `${window.PTModels.formatQty(len, 2)} LF`;
          if (this.tool === 'linear' && this.linearMode === 'segment') label += ' · seg';
        }
        if (this.angleLockDeg != null) label += `  ${this.angleLockDeg}°`;
        const fontPx = 12 / this.view.scale;
        ctx2.font = `600 ${fontPx}px Segoe UI, sans-serif`;
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'bottom';
        const pad = 3 / this.view.scale;
        const tw = ctx2.measureText(label).width;
        ctx2.fillStyle = 'rgba(0,0,0,0.7)';
        ctx2.fillRect(mid.x - tw / 2 - pad, mid.y - fontPx - pad * 2, tw + pad * 2, fontPx + pad * 2);
        ctx2.fillStyle = '#fff';
        ctx2.fillText(label, mid.x, mid.y - pad);
      }
    }

    ctx2.restore();
    ctx2.restore();
  }

  _drawTakeoff(ctx2, t, cond, selected) {
    // Always use live condition color (properties Save must show immediately)
    const color = normalizeCssColor(cond?.color) || '#e74c3c';
    const lw = (cond.lineWidth || 2.5) / this.view.scale;
    const pts = t.geometry?.points || [];
    if (!pts.length) return;

    if (t.kind === 'point') {
      const p = pts[0];
      const r = 8 / this.view.scale;
      if (selected) {
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, r + 3 / this.view.scale, 0, Math.PI * 2);
        ctx2.strokeStyle = '#ffffff';
        ctx2.lineWidth = 3 / this.view.scale;
        ctx2.stroke();
      }
      ctx2.beginPath();
      ctx2.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx2.fillStyle = color;
      ctx2.globalAlpha = 0.9;
      ctx2.fill();
      ctx2.globalAlpha = 1;
      ctx2.strokeStyle = color;
      ctx2.lineWidth = 2 / this.view.scale;
      ctx2.stroke();
      ctx2.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx2.lineWidth = 1 / this.view.scale;
      ctx2.beginPath();
      ctx2.moveTo(p.x - r * 0.7, p.y);
      ctx2.lineTo(p.x + r * 0.7, p.y);
      ctx2.moveTo(p.x, p.y - r * 0.7);
      ctx2.lineTo(p.x, p.y + r * 0.7);
      ctx2.stroke();
      return;
    }

    // White halo when selected (does NOT replace condition color)
    if (selected) {
      ctx2.beginPath();
      pts.forEach((p, i) => (i ? ctx2.lineTo(p.x, p.y) : ctx2.moveTo(p.x, p.y)));
      if (t.kind === 'polygon') ctx2.closePath();
      ctx2.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx2.lineWidth = lw + 4 / this.view.scale;
      ctx2.lineJoin = 'round';
      ctx2.lineCap = 'round';
      ctx2.stroke();
    }

    ctx2.beginPath();
    pts.forEach((p, i) => (i ? ctx2.lineTo(p.x, p.y) : ctx2.moveTo(p.x, p.y)));
    if (t.kind === 'polygon' || t.kind === 'deduction') {
      ctx2.closePath();
      const pattern = t.isDeduction ? 'hatch' : cond.fillPattern || 'solid';
      const baseAlpha =
        cond.fillOpacity != null
          ? Number(cond.fillOpacity)
          : selected
            ? 0.32
            : 0.2;
      if (pattern !== 'transparent') {
        const fill = makeConditionPattern(
          ctx2,
          t.isDeduction ? '#ef4444' : color,
          pattern,
          this.view.scale
        );
        ctx2.fillStyle = fill || color;
        ctx2.globalAlpha = t.isDeduction
          ? 0.35
          : pattern === 'solid'
            ? baseAlpha
            : Math.min(0.85, baseAlpha + 0.25);
        ctx2.fill();
        ctx2.globalAlpha = 1;
      }
    }
    ctx2.strokeStyle = t.isDeduction ? '#ef4444' : color;
    if (t.isDeduction) {
      ctx2.setLineDash([6 / this.view.scale, 4 / this.view.scale]);
    }
    ctx2.lineWidth = selected ? lw + 0.5 / this.view.scale : lw;
    ctx2.lineJoin = 'round';
    ctx2.lineCap = 'round';
    ctx2.stroke();
    ctx2.setLineDash([]);

    // Segment LF / object total labels on completed marks
    this._drawTakeoffLabels(ctx2, t, cond, pts, color);

    // Editable grips when selected
    if (selected) {
      const gr = 5.5 / this.view.scale;
      pts.forEach((p, i) => {
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, gr, 0, Math.PI * 2);
        const isHot = i === this.selectedVertexIndex;
        ctx2.fillStyle = isHot ? '#fde047' : '#ffffff';
        ctx2.fill();
        ctx2.strokeStyle = color;
        ctx2.lineWidth = 2 / this.view.scale;
        ctx2.stroke();
      });
      // Mid-edge “+” hints when insert mode
      if (this.editMode === 'insert' && t.kind !== 'point') {
        const n = pts.length;
        const edges = t.kind === 'polygon' ? n : n - 1;
        for (let i = 0; i < edges; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const s = 4 / this.view.scale;
          ctx2.strokeStyle = '#4ade80';
          ctx2.lineWidth = 1.5 / this.view.scale;
          ctx2.beginPath();
          ctx2.moveTo(mx - s, my);
          ctx2.lineTo(mx + s, my);
          ctx2.moveTo(mx, my - s);
          ctx2.lineTo(mx, my + s);
          ctx2.stroke();
        }
      }
    }
  }

  _drawTakeoffLabels(ctx2, t, cond, pts, color) {
    const ctx = this.getContext();
    const page = ctx.page;
    const project = ctx.project;
    if (!page?.feetPerPixel || !pts.length) return;

    const showSeg =
      this.showSegmentLabels &&
      (project?.showSegmentLabels !== false);
    const showTot =
      this.showObjectTotals &&
      (project?.showObjectTotals !== false);

    const fontPx = Math.max(10, 11 / this.view.scale);
    ctx2.font = `600 ${fontPx}px Segoe UI, sans-serif`;
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';

    if (showSeg && (t.kind === 'polyline' || t.kind === 'segment' || t.kind === 'polygon')) {
      const n = pts.length;
      const edges = t.kind === 'polygon' ? n : n - 1;
      for (let i = 0; i < edges; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        const len = window.PTModels.distancePx(a, b) * page.feetPerPixel;
        if (len < 0.05) continue;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const label = `${window.PTModels.formatQty(len, 2)} LF`;
        this._paintLabelBubble(ctx2, mid.x, mid.y, label, color, fontPx);
      }
    }

    if (showTot && window.PTModels.computeObjectQuantity) {
      const q = window.PTModels.computeObjectQuantity(t, cond, page);
      if (q.primary > 0 && t.kind !== 'point') {
        let cx = 0;
        let cy = 0;
        pts.forEach((p) => {
          cx += p.x;
          cy += p.y;
        });
        cx /= pts.length;
        cy /= pts.length;
        const unit = cond.unitPrimary || '';
        const label = `${window.PTModels.formatQty(q.primary, 2)} ${unit}`;
        this._paintLabelBubble(ctx2, cx, cy, label, color, fontPx * 1.05, true);
      } else if (t.kind === 'point' && showTot) {
        const p0 = pts[0];
        this._paintLabelBubble(ctx2, p0.x, p0.y - 14 / this.view.scale, '1 EA', color, fontPx, true);
      }
    }
  }

  _paintLabelBubble(ctx2, x, y, text, color, fontPx, emphasize = false) {
    const pad = 3 / this.view.scale;
    ctx2.font = `${emphasize ? '700' : '600'} ${fontPx}px Segoe UI, sans-serif`;
    const tw = ctx2.measureText(text).width;
    const h = fontPx + pad * 2;
    const w = tw + pad * 2;
    ctx2.fillStyle = emphasize ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.62)';
    ctx2.strokeStyle = color;
    ctx2.lineWidth = 1 / this.view.scale;
    const rx = x - w / 2;
    const ry = y - h / 2;
    ctx2.beginPath();
    if (ctx2.roundRect) ctx2.roundRect(rx, ry, w, h, 3 / this.view.scale);
    else ctx2.rect(rx, ry, w, h);
    ctx2.fill();
    ctx2.stroke();
    ctx2.fillStyle = '#fff';
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(text, x, y);
  }
}

/** Create a canvas pattern for hatch/diamond/etc. */
function makeConditionPattern(ctx2, color, pattern, viewScale) {
  const size = Math.max(8, Math.round(12 / Math.max(viewScale, 0.3)));
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.2;
  if (pattern === 'solid') return color;
  if (pattern === 'transparent') return null;
  if (pattern === 'hatch') {
    g.beginPath();
    g.moveTo(0, size);
    g.lineTo(size, 0);
    g.stroke();
  } else if (pattern === 'crosshatch') {
    g.beginPath();
    g.moveTo(0, size);
    g.lineTo(size, 0);
    g.moveTo(0, 0);
    g.lineTo(size, size);
    g.stroke();
  } else if (pattern === 'diamond') {
    g.beginPath();
    g.moveTo(size / 2, 0);
    g.lineTo(size, size / 2);
    g.lineTo(size / 2, size);
    g.lineTo(0, size / 2);
    g.closePath();
    g.stroke();
  } else if (pattern === 'dots') {
    g.beginPath();
    g.arc(size / 2, size / 2, Math.max(1, size * 0.12), 0, Math.PI * 2);
    g.fill();
  } else if (pattern === 'lines-h') {
    g.beginPath();
    g.moveTo(0, size / 2);
    g.lineTo(size, size / 2);
    g.stroke();
  } else if (pattern === 'lines-v') {
    g.beginPath();
    g.moveTo(size / 2, 0);
    g.lineTo(size / 2, size);
    g.stroke();
  } else {
    return color;
  }
  return ctx2.createPattern(c, 'repeat');
}

function projectOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function normalizeCssColor(c) {
  if (!c || typeof c !== 'string') return null;
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  const rgb = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) {
    const h = (n) => Number(n).toString(16).padStart(2, '0');
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
  }
  return s; // named colors still work on canvas
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return window.PTModels.distancePx(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return window.PTModels.distancePx(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

window.PlanCanvas = PlanCanvas;

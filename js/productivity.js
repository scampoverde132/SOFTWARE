/**
 * PlanTakeoff painting productivity engine.
 * Loaded before app.js; extends existing models/UI without changing saved-job shape.
 */
(function () {
  'use strict';

  const DEFAULT_WASTE = 10;
  const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  const TEMPLATES = {
    walls: { label: 'Walls', style: 'linear', name: 'Walls', type: 'Finishes', height: 9, coverageRate: 350, estimateQtyMode: 'surface', materialRateMode: 'perGallon', color: '#e74c3c' },
    ceilings: { label: 'Ceilings', style: 'area', name: 'Ceilings', type: 'Finishes', coverageRate: 300, estimateQtyMode: 'primary', materialRateMode: 'perGallon', color: '#3498db' },
    doors: { label: 'Doors', style: 'count', name: 'Doors', type: 'Doors & Windows', coverageRate: 350, estimateQtyMode: 'primary', materialRateMode: 'perUnit', color: '#f39c12' },
    base: { label: 'Base', style: 'linear', name: 'Base', type: 'Finishes', height: 0.33, coverageRate: 350, estimateQtyMode: 'primary', materialRateMode: 'perGallon', color: '#9b59b6' },
    trim: { label: 'Trim', style: 'linear', name: 'Trim', type: 'Finishes', height: 0.25, coverageRate: 350, estimateQtyMode: 'primary', materialRateMode: 'perGallon', color: '#8e44ad' },
    exterior: { label: 'Exterior', style: 'area', name: 'Exterior', type: 'Exterior Improvements', coverageRate: 350, estimateQtyMode: 'primary', materialRateMode: 'perGallon', color: '#16a085' },
  };

  // Material: $/gal except doors ($/EA). Labor/Sub: $ per estimate quantity unit.
  const DEFAULT_RATES = {
    walls: { material: 45, labor: 0.85, sub: 0, coverageRate: 350 },
    ceilings: { material: 40, labor: 0.70, sub: 0, coverageRate: 300 },
    doors: { material: 18, labor: 85, sub: 0, coverageRate: 350 },
    base: { material: 45, labor: 1.10, sub: 0, coverageRate: 350 },
    trim: { material: 45, labor: 1.40, sub: 0, coverageRate: 350 },
    exterior: { material: 48, labor: 1.10, sub: 0, coverageRate: 350 },
  };

  let appState = null;
  let activeCanvas = null;
  let saveTimer = null;
  let renderQueued = false;
  let rendering = false;
  let observer = null;
  let suppressGeomHistory = false;

  const clone = (v) => {
    if (v == null) return v;
    try { return structuredClone(v); } catch (_) { return JSON.parse(JSON.stringify(v)); }
  };
  const finite = (v) => Number.isFinite(Number(v));
  const pct = (v, fallback = DEFAULT_WASTE) => finite(v) ? Math.max(0, Math.min(100, Number(v))) : fallback;
  const money = (v) => MONEY.format(Number(v) || 0);
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function installStoreCapture() {
    const S = window.PTStore;
    if (!S || S.__paintProductivityCapture) return !!S;
    S.__paintProductivityCapture = true;

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
      S.saveState = async function (state, ...args) {
        appState = state || appState;
        return original.call(this, state, ...args);
      };
    }
    return true;
  }

  function currentProject() {
    const fromCanvas = activeCanvas?.getContext?.()?.project;
    if (fromCanvas) return fromCanvas;
    return (appState?.projects || []).find((p) => p.id === appState.activeProjectId) || null;
  }

  function persist(project, immediate = false) {
    const S = window.PTStore;
    if (!project || !S || !appState) return;
    S.touchProject?.(project);
    if (saveTimer) clearTimeout(saveTimer);
    const run = () => {
      saveTimer = null;
      try {
        const result = S.saveState(appState);
        result?.catch?.((e) => console.error('PlanTakeoff productivity save failed', e));
      } catch (e) {
        console.error('PlanTakeoff productivity save failed', e);
      }
    };
    if (immediate) run();
    else saveTimer = setTimeout(run, 120);
  }

  function classify(c) {
    const role = String(c?.rateKey || c?.roomRole || '').toLowerCase();
    const name = String(c?.name || '').toLowerCase();
    if (role.includes('ceiling') || name.includes('ceiling')) return 'ceilings';
    if (role.includes('door') || name.includes('door')) return 'doors';
    if (role.includes('base') || name.includes('base') || name.includes('shoe')) return 'base';
    if (role.includes('trim') || role.includes('crown') || role.includes('chair') || name.includes('trim') || name.includes('crown') || name.includes('molding') || name.includes('chair rail')) return 'trim';
    if (role.includes('exterior') || name.includes('exterior') || name.includes('facade')) return 'exterior';
    return 'walls';
  }

  const defaultCoverage = (c) => classify(c) === 'ceilings' ? 300 : 350;

  function settings(project) {
    if (!project) return { wastePct: DEFAULT_WASTE, rates: clone(DEFAULT_RATES) };
    project.paintingSettings ||= {};
    project.paintingSettings.wastePct = pct(project.paintingSettings.wastePct);
    project.paintingSettings.rates ||= clone(DEFAULT_RATES);
    for (const [key, defaults] of Object.entries(DEFAULT_RATES)) {
      project.paintingSettings.rates[key] = { ...defaults, ...(project.paintingSettings.rates[key] || {}) };
    }
    return project.paintingSettings;
  }

  function normalizeCondition(c) {
    if (!c) return c;
    c.coverageRate = finite(c.coverageRate) && Number(c.coverageRate) > 0 ? Number(c.coverageRate) : defaultCoverage(c);
    c.rateKey ||= classify(c);
    c.estimateQtyMode ||= c.rateKey === 'walls' && c.style === 'linear' ? 'surface' : 'primary';
    c.materialRateMode ||= 'legacyPerUnit';
    if (c.wastePct != null && c.wastePct !== '') c.wastePct = pct(c.wastePct);
    return c;
  }

  function normalizeProject(project) {
    if (!project) return project;
    settings(project);
    for (const c of project.conditions || []) normalizeCondition(c);
    for (const t of project.takeoffs || []) {
      if (t.wastePct !== null && t.wastePct !== undefined && t.wastePct !== '') t.wastePct = pct(t.wastePct);
      if (t.isDeduct && !t.isDeduction) t.isDeduction = true;
    }
    return project;
  }

  function wasteFor(project, condition, takeoff) {
    if (takeoff?.wastePct !== null && takeoff?.wastePct !== undefined && takeoff?.wastePct !== '') return pct(takeoff.wastePct);
    if (condition?.wastePct !== null && condition?.wastePct !== undefined && condition?.wastePct !== '') return pct(condition.wastePct);
    return settings(project).wastePct;
  }

  function paintMetrics(project, condition) {
    const M = window.PTModels;
    normalizeProject(project);
    normalizeCondition(condition);
    const coverageRate = Math.max(1, Number(condition.coverageRate) || defaultCoverage(condition));
    let squareFeet = 0;
    let gallons = 0;

    for (const t of project?.takeoffs || []) {
      if (t.conditionId !== condition.id) continue;
      if (t.parentId && (t.isDeduct || t.isDeduction)) continue;
      const page = (project.pages || []).find((p) => p.id === t.pageId);
      if (!page) continue;
      const q = M.computeNetObjectQuantity
        ? M.computeNetObjectQuantity(project, t, condition, page)
        : M.computeObjectQuantity(t, condition, page);
      let sf = 0;
      if (condition.style === 'linear') sf = Number(q.secondary) || 0;
      else if (condition.style === 'area' || t.kind === 'polygon') sf = Number(q.primary) || 0;
      squareFeet += sf;
      gallons += (sf / coverageRate) * (1 + wasteFor(project, condition, t) / 100);
    }
    return { squareFeet, gallons, coverageRate, wastePct: settings(project).wastePct };
  }

  function estimateQty(condition, q) {
    if (condition.estimateQtyMode === 'surface' && Number(q.secondary)) {
      return { qty: Number(q.secondary), unit: condition.unitSecondary || 'SF' };
    }
    return { qty: Number(q.primary) || 0, unit: condition.unitPrimary || '' };
  }

  function applyRate(project, condition) {
    const key = classify(condition);
    const rate = settings(project).rates[key] || DEFAULT_RATES.walls;
    condition.rateKey = key;
    condition.coverageRate = Number(rate.coverageRate) || defaultCoverage(condition);
    condition.materialUnitCost = Number(rate.material) || 0;
    condition.laborUnitCost = Number(rate.labor) || 0;
    condition.subUnitCost = Number(rate.sub) || 0;
    condition.materialRateMode = key === 'doors' ? 'perUnit' : 'perGallon';
    condition.estimateQtyMode = key === 'walls' && condition.style === 'linear' ? 'surface' : 'primary';
    return condition;
  }

  function conditionLines(project, hideZero) {
    const M = window.PTModels;
    normalizeProject(project);
    const rows = [];
    for (const c of project.conditions || []) {
      const q = M.aggregateConditionQuantities(project, c.id);
      const estimate = estimateQty(c, q);
      const paint = paintMetrics(project, c);
      const matRate = Number(c.materialUnitCost) || 0;
      const labRate = Number(c.laborUnitCost) || 0;
      const subRate = Number(c.subUnitCost) || 0;
      const material = c.materialRateMode === 'perGallon' ? paint.gallons * matRate : estimate.qty * matRate;
      const labor = estimate.qty * labRate;
      const sub = estimate.qty * subRate;
      const row = {
        section: 'takeoff', conditionId: c.id, number: c.number, name: c.name,
        qty: estimate.qty, unit: estimate.unit, gallons: paint.gallons,
        paintSf: paint.squareFeet, coverageRate: paint.coverageRate,
        materialUnitCost: matRate, laborUnitCost: labRate, subUnitCost: subRate,
        equipmentUnitCost: 0, otherUnitCost: 0,
        material, labor, sub, equipment: 0, other: 0, total: material + labor + sub,
        isAssembly: false, qtyMode: c.estimateQtyMode || 'primary', rateKey: c.rateKey,
      };
      if (!hideZero || Math.abs(row.qty) > 1e-9 || Math.abs(row.total) > 1e-9) rows.push(row);
    }
    return rows;
  }

  function rollup(takeoffLines, gearLines) {
    const sum = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
    const takeoff = {
      material: sum(takeoffLines, 'material'), labor: sum(takeoffLines, 'labor'),
      sub: sum(takeoffLines, 'sub'), equipment: 0, other: 0,
    };
    takeoff.total = takeoff.material + takeoff.labor + takeoff.sub;
    const gear = {
      material: sum(gearLines, 'material'), labor: sum(gearLines, 'labor'),
      sub: sum(gearLines, 'sub'), equipment: sum(gearLines, 'equipment'), other: sum(gearLines, 'other'),
    };
    gear.total = gear.material + gear.labor + gear.sub + gear.equipment + gear.other;
    const totals = {
      material: takeoff.material + gear.material, labor: takeoff.labor + gear.labor,
      sub: takeoff.sub + gear.sub, equipment: gear.equipment, other: gear.other,
    };
    totals.grand = totals.material + totals.labor + totals.sub + totals.equipment + totals.other;
    return { takeoff, gear, totals };
  }

  function installModels() {
    const M = window.PTModels;
    if (!M || M.__paintProductivityInstalled) return !!M;
    M.__paintProductivityInstalled = true;
    M.DEFAULT_PAINTING_RATES = DEFAULT_RATES;
    M.PAINTING_TEMPLATES = TEMPLATES;
    M.DEFAULT_WASTE_PCT = DEFAULT_WASTE;
    M.normalizePaintingProject = normalizeProject;
    M.conditionPaintMetrics = paintMetrics;
    M.computePaintGallons = (project, condition) => paintMetrics(project, condition).gallons;
    M.applyDefaultPaintingRate = applyRate;

    if (M.createProject) {
      const original = M.createProject;
      M.createProject = function (overrides = {}) {
        return normalizeProject(original(overrides));
      };
    }
    if (M.createCondition) {
      const original = M.createCondition;
      M.createCondition = function (style = 'linear', overrides = {}) {
        const provisional = { style, name: overrides.name || '', ...overrides };
        return normalizeCondition(original(style, { coverageRate: defaultCoverage(provisional), ...overrides }));
      };
    }
    if (M.createTakeoffObject) {
      const original = M.createTakeoffObject;
      M.createTakeoffObject = function (...args) {
        const t = original.apply(this, args);
        if (t.wastePct === undefined) t.wastePct = null;
        return t;
      };
    }
    if (M.buildFullEstimate) {
      const original = M.buildFullEstimate;
      M.buildFullEstimate = function (project, opts = {}) {
        normalizeProject(project);
        const legacy = original(project, opts);
        const takeoffLines = conditionLines(project, !!opts.hideZero);
        const gearLines = legacy.gearLines || [];
        return { takeoffLines, gearLines, ...rollup(takeoffLines, gearLines) };
      };
    }
    return true;
  }

  function installCanvasCapture() {
    const C = window.PlanCanvas;
    if (!C || C.prototype.__paintProductivityCapture) return false;
    C.prototype.__paintProductivityCapture = true;
    const originalDraw = C.prototype.draw;
    C.prototype.draw = function (...args) {
      activeCanvas = this;
      normalizeProject(this.getContext?.()?.project);
      const result = originalDraw.apply(this, args);
      syncMarkControls();
      return result;
    };
    return true;
  }

  function persistViaCanvas(takeoff) {
    if (activeCanvas?.onChange && takeoff) {
      const points = (takeoff.geometry?.points || []).map((p) => ({ x: p.x, y: p.y }));
      suppressGeomHistory = true;
      const H = window.PTHistory;
      const originalPush = H?.push;
      if (H && originalPush) {
        H.push = function (entry) {
          if (suppressGeomHistory && entry?.type === 'geom') {
            suppressGeomHistory = false;
            H.push = originalPush;
            return;
          }
          return originalPush.call(H, entry);
        };
      }
      activeCanvas.onChange({ type: 'update-takeoff', id: takeoff.id, prevPoints: points, points });
      if (H && originalPush && H.push !== originalPush) H.push = originalPush;
    } else {
      persist(currentProject());
    }
  }

  function enhanceTemplateUi() {
    const toolbar = document.getElementById('takeoffToolbar');
    if (!toolbar || document.getElementById('paintingTemplateSelect')) return !!toolbar;
    const group = document.createElement('div');
    group.className = 'group';
    group.innerHTML = `
      <label class="small">Painting template</label>
      <select id="paintingTemplateSelect" style="min-width:108px">
        ${Object.entries(TEMPLATES).map(([key, t]) => `<option value="${key}">${esc(t.label)}</option>`).join('')}
      </select>
      <button type="button" id="btnAddPaintingTemplate">+ Template</button>`;
    toolbar.appendChild(group);
    group.querySelector('button').addEventListener('click', addTemplateCondition);
    return true;
  }

  function addTemplateCondition() {
    const M = window.PTModels;
    const project = currentProject();
    const key = document.getElementById('paintingTemplateSelect')?.value || 'walls';
    const t = TEMPLATES[key];
    if (!M || !project || !t) return;
    normalizeProject(project);
    const c = M.createCondition(t.style, {
      number: M.nextConditionNumber(project), name: t.name, type: t.type,
      layerId: project.layers?.[0]?.id || null, color: t.color, height: t.height || 0,
      coverageRate: t.coverageRate, estimateQtyMode: t.estimateQtyMode,
      materialRateMode: t.materialRateMode, rateKey: key,
    });
    applyRate(project, c);
    project.conditions.push(c);

    if (activeCanvas?.onChange) {
      activeCanvas.onChange({ type: 'selection', ids: [], conditionId: c.id });
      const tool = c.style === 'area' ? 'area' : c.style === 'count' ? 'count' : 'linear';
      activeCanvas.onToolRequest?.(tool) || activeCanvas.setTool?.(tool);
      activeCanvas.onChange({ type: 'status-msg', message: `${t.label} created · ${c.coverageRate} SF/gal · ready to measure` });
    } else {
      project.activeConditionId = c.id;
      persist(project, true);
    }
    queueRender();
  }

  function selectedTakeoffs() {
    const project = currentProject();
    const ids = activeCanvas?.selectedIds || new Set();
    return project ? (project.takeoffs || []).filter((t) => ids.has(t.id)) : [];
  }

  function selectedCondition() {
    const project = currentProject();
    if (!project) return null;
    const id = selectedTakeoffs()[0]?.conditionId || project.activeConditionId;
    return (project.conditions || []).find((c) => c.id === id) || null;
  }

  function enhanceMarkControls() {
    const bar = document.getElementById('markPropsBar');
    const row = bar?.querySelector('.mark-props-row:last-of-type') || bar?.querySelector('.mark-props-row');
    if (!row) return false;

    if (!document.getElementById('markWastePct')) {
      const label = document.createElement('label');
      label.className = 'small';
      label.title = 'Blank uses global project waste';
      label.innerHTML = 'Waste % <input type="number" id="markWastePct" min="0" max="100" step="0.5" placeholder="global" style="width:68px" />';
      row.insertBefore(label, row.firstChild);
      label.querySelector('input').addEventListener('change', (e) => setTakeoffWaste(e.target.value));
    }
    if (!document.getElementById('conditionCoverageRate')) {
      const label = document.createElement('label');
      label.className = 'small';
      label.innerHTML = 'Coverage <input type="number" id="conditionCoverageRate" min="1" step="10" style="width:76px" /> SF/gal';
      row.insertBefore(label, row.firstChild);
      label.querySelector('input').addEventListener('change', (e) => setCoverage(e.target.value));
    }

    const canvas = document.getElementById('planCanvas');
    if (canvas && !canvas.dataset.paintProductivitySync) {
      canvas.dataset.paintProductivitySync = '1';
      canvas.addEventListener('mouseup', () => setTimeout(syncMarkControls, 0));
    }
    return true;
  }

  function syncMarkControls() {
    const waste = document.getElementById('markWastePct');
    const coverage = document.getElementById('conditionCoverageRate');
    const selected = selectedTakeoffs();
    const condition = selectedCondition();

    if (waste) {
      waste.disabled = !selected.length;
      const values = selected.map((t) => t.wastePct == null || t.wastePct === '' ? null : Number(t.wastePct));
      const first = values[0];
      waste.value = selected.length && values.every((v) => v === first) && first !== null ? String(first) : '';
      waste.placeholder = values.some((v) => v !== first) ? 'mixed' : 'global';
    }
    if (coverage) {
      coverage.disabled = !condition;
      coverage.value = condition ? String(normalizeCondition(condition).coverageRate) : '';
    }
  }

  function setTakeoffWaste(raw) {
    const selected = selectedTakeoffs();
    if (!selected.length) return;
    const value = String(raw).trim() === '' ? null : pct(raw);
    const H = window.PTHistory;
    H?.recordProps?.(selected.map((target) => ({
      target, targetType: 'takeoff',
      prev: { wastePct: target.wastePct ?? null },
      next: { wastePct: value },
    })));
    for (const t of selected) t.wastePct = value;
    persistViaCanvas(selected[0]);
    syncMarkControls();
    queueRender();
  }

  function setCoverage(raw) {
    const project = currentProject();
    const condition = selectedCondition();
    const value = Number(raw);
    if (!project || !condition || !(value > 0)) return;
    condition.coverageRate = value;
    persist(project);
    queueRender();
    activeCanvas?.onChange?.({ type: 'status-msg', message: `${condition.name} coverage set to ${value} SF/gal` });
  }

  function enhanceEstimateUi() {
    const table = document.getElementById('estimateTable');
    const toolbar = document.querySelector('#panel-estimate .toolbar');
    if (!table || !toolbar) return false;

    const header = table.querySelector('thead tr');
    if (header && !header.dataset.paintProductivity) {
      header.dataset.paintProductivity = '1';
      header.innerHTML = '<th>Condition</th><th class="num">Qty</th><th>Unit</th><th class="num">Gallons</th><th class="num">Material $</th><th class="num">Labor $</th><th class="num">Sub $</th><th class="num">Total</th>';
    }

    if (!document.getElementById('paintingProductivityControls')) {
      const group = document.createElement('div');
      group.className = 'group';
      group.id = 'paintingProductivityControls';
      group.innerHTML = `
        <button type="button" id="btnApplyPaintingRates" class="primary">Apply default painting rates</button>
        <label class="small">Global waste <input type="number" id="paintingGlobalWaste" min="0" max="100" step="0.5" value="${DEFAULT_WASTE}" style="width:64px" /> %</label>
        <button type="button" id="btnRefreshScaleQty">Refresh quantities</button>`;
      toolbar.insertBefore(group, toolbar.firstChild);
      group.querySelector('#btnApplyPaintingRates').addEventListener('click', applyRates);
      group.querySelector('#paintingGlobalWaste').addEventListener('change', setGlobalWaste);
      group.querySelector('#btnRefreshScaleQty').addEventListener('click', refreshScaleQuantities);
    }

    const tbody = table.querySelector('tbody');
    if (tbody && !observer) {
      observer = new MutationObserver(queueRender);
      observer.observe(tbody, { childList: true });
    }

    const exportBtn = document.getElementById('btnExportEstimateCsv');
    if (exportBtn && !exportBtn.dataset.paintProductivity) {
      exportBtn.dataset.paintProductivity = '1';
      exportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportCsv();
      }, true);
    }
    queueRender();
    return true;
  }

  function applyRates() {
    const project = currentProject();
    if (!project) return;
    normalizeProject(project);
    for (const c of project.conditions || []) applyRate(project, c);
    persist(project, true);
    queueRender();
    activeCanvas?.onChange?.({ type: 'status-msg', message: `Default painting rates applied to ${project.conditions.length} condition(s).` });
  }

  function setGlobalWaste(e) {
    const project = currentProject();
    if (!project) return;
    const value = pct(e.target.value);
    settings(project).wastePct = value;
    e.target.value = String(value);
    persist(project);
    queueRender();
  }

  function refreshScaleQuantities() {
    const project = currentProject();
    if (!project) return;
    normalizeProject(project);
    queueRender();
    activeCanvas?.draw?.();
    activeCanvas?._emitStatus?.(activeCanvas.hover);
    activeCanvas?.onChange?.({ type: 'status-msg', message: 'Quantities, gallons, and estimate refreshed from current page scales.' });
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderEstimate();
    });
  }

  function renderEstimate() {
    if (rendering) return;
    const tbody = document.querySelector('#estimateTable tbody');
    const totalsBar = document.getElementById('estimateTotals');
    const project = currentProject();
    if (!tbody || !totalsBar) return;

    rendering = true;
    observer?.disconnect();
    try {
      tbody.innerHTML = '';
      if (!project) {
        totalsBar.innerHTML = '';
        return;
      }
      normalizeProject(project);
      const globalWaste = document.getElementById('paintingGlobalWaste');
      if (globalWaste && document.activeElement !== globalWaste) globalWaste.value = String(settings(project).wastePct);
      const full = window.PTModels.buildFullEstimate(project, { hideZero: document.getElementById('estimateHideZero')?.checked });

      const section = (title, detail) => {
        const tr = document.createElement('tr');
        tr.className = 'est-section-row';
        tr.innerHTML = `<td colspan="8"><strong>${esc(title)}</strong> <span style="color:var(--text-dim);font-weight:500">${esc(detail)}</span></td>`;
        tbody.appendChild(tr);
      };
      const line = (r, gear = false) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(r.name || 'Line')}</td><td class="num">${window.PTModels.formatQty(r.qty, 2)}</td><td>${esc(r.unit || '')}</td><td class="num">${gear ? '—' : window.PTModels.formatQty(r.gallons || 0, 2)}</td><td class="num">${money(r.material)}</td><td class="num">${money(r.labor)}</td><td class="num">${money(r.sub || 0)}</td><td class="num"><strong>${money(r.total)}</strong></td>`;
        if (!gear) tr.title = `${window.PTModels.formatQty(r.paintSf || 0, 1)} SF paint area · ${window.PTModels.formatQty(r.coverageRate || 0, 0)} SF/gal`;
        tbody.appendChild(tr);
      };

      section('A. Painting takeoff', `${full.takeoffLines.length} condition(s) · gallons include waste`);
      if (full.takeoffLines.length) full.takeoffLines.forEach((r) => line(r));
      else tbody.insertAdjacentHTML('beforeend', '<tr><td colspan="8" style="color:var(--text-dim)">No measured painting quantities yet.</td></tr>');

      if (full.gearLines.length) {
        section('B. Equipment, supplies & mobilization', `${full.gearLines.length} worksheet line(s)`);
        full.gearLines.forEach((r) => line(r, true));
      }

      const T = full.totals || {};
      tbody.insertAdjacentHTML('beforeend', `<tr class="est-total-row"><td colspan="4"><strong>Totals</strong></td><td class="num"><strong>${money(T.material)}</strong></td><td class="num"><strong>${money(T.labor)}</strong></td><td class="num"><strong>${money(T.sub)}</strong></td><td class="num"><strong>${money(T.grand)}</strong></td></tr>`);
      const gallons = full.takeoffLines.reduce((s, r) => s + (Number(r.gallons) || 0), 0);
      totalsBar.innerHTML = `<span><span class="t-label">Paint</span><span class="t-val">${window.PTModels.formatQty(gallons, 2)} gal</span></span><span><span class="t-label">Material</span><span class="t-val money">${money(T.material)}</span></span><span><span class="t-label">Labor</span><span class="t-val money">${money(T.labor)}</span></span><span><span class="t-label">Sub</span><span class="t-val money">${money(T.sub)}</span></span><span><span class="t-label">Grand Total</span><span class="t-val money">${money(T.grand)}</span></span>`;
    } finally {
      rendering = false;
      if (observer && tbody) observer.observe(tbody, { childList: true });
    }
  }

  function exportCsv() {
    const project = currentProject();
    if (!project) return;
    const full = window.PTModels.buildFullEstimate(project, { hideZero: false });
    const rows = [['Condition', 'Qty', 'Unit', 'Gallons', 'Material $', 'Labor $', 'Sub $', 'Total']];
    for (const r of [...full.takeoffLines, ...full.gearLines]) {
      rows.push([r.name || '', r.qty || 0, r.unit || '', r.gallons || 0, r.material || 0, r.labor || 0, r.sub || 0, r.total || 0]);
    }
    rows.push(['TOTALS', '', '', '', full.totals.material || 0, full.totals.labor || 0, full.totals.sub || 0, full.totals.grand || 0]);
    const csv = rows.map((row) => row.map((v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.jobNumber || project.name || 'PlanTakeoff'}-painting-estimate.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function installAll() {
    installStoreCapture();
    installModels();
    installCanvasCapture();
    enhanceTemplateUi();
    enhanceMarkControls();
    enhanceEstimateUi();
    normalizeProject(currentProject());
  }

  installStoreCapture();
  installModels();

  document.addEventListener('DOMContentLoaded', () => {
    installAll();
    let tries = 0;
    const timer = setInterval(() => {
      installAll();
      tries += 1;
      if (tries >= 80 || (window.PlanCanvas && document.getElementById('paintingProductivityControls') && document.getElementById('markWastePct'))) clearInterval(timer);
    }, 100);
  });
})();

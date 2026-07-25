/**
 * PlanTakeoff — domain model
 * Independent takeoff/estimating app inspired by public On-Screen Takeoff workflows.
 */

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const PRESET_SCALES = [
  { id: 'custom', label: 'Custom / Calibrated', feetPerInch: null },
  { id: '1/8', label: '1/8" = 1\'-0"', feetPerInch: 8 },
  { id: '3/16', label: '3/16" = 1\'-0"', feetPerInch: 16 / 3 },
  { id: '1/4', label: '1/4" = 1\'-0"', feetPerInch: 4 },
  { id: '3/8', label: '3/8" = 1\'-0"', feetPerInch: 8 / 3 },
  { id: '1/2', label: '1/2" = 1\'-0"', feetPerInch: 2 },
  { id: '3/4', label: '3/4" = 1\'-0"', feetPerInch: 4 / 3 },
  { id: '1', label: '1" = 1\'-0"', feetPerInch: 1 },
  { id: '1:10', label: '1:10 (metric-ish)', feetPerInch: 10 },
  { id: '1:20', label: '1:20', feetPerInch: 20 },
  { id: '1:50', label: '1:50', feetPerInch: 50 },
  { id: '1:100', label: '1:100', feetPerInch: 100 },
];

const CONDITION_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#2980b9', '#c0392b', '#16a085',
  '#8e44ad', '#d35400', '#27ae60', '#f1c40f', '#e91e63',
];

const DEFAULT_LAYERS = () => [
  { id: uid(), name: 'Architectural', visible: true, color: '#3498db' },
  { id: uid(), name: 'Structural', visible: true, color: '#e74c3c' },
  { id: uid(), name: 'MEP', visible: true, color: '#2ecc71' },
  { id: uid(), name: 'Site', visible: true, color: '#f39c12' },
  { id: uid(), name: 'Annotations', visible: true, color: '#95a5a6' },
];

const CONDITION_TYPES = [
  'General', 'Concrete', 'Masonry', 'Metals', 'Wood', 'Thermal & Moisture',
  'Doors & Windows', 'Finishes', 'Specialties', 'Equipment', 'Furnishings',
  'Special Construction', 'Conveying', 'Fire Suppression', 'Plumbing',
  'HVAC', 'Electrical', 'Earthwork', 'Exterior Improvements', 'Utilities',
];

function createLayer(overrides = {}) {
  return {
    id: uid(),
    name: 'New Layer',
    visible: true,
    color: '#888888',
    ...overrides,
  };
}

function createCondition(style = 'linear', overrides = {}) {
  const color = overrides.color || CONDITION_COLORS[Math.floor(Math.random() * CONDITION_COLORS.length)];
  const base = {
    id: uid(),
    number: 0,
    name: style === 'linear' ? 'New Linear' : style === 'area' ? 'New Area' : style === 'count' ? 'New Count' : 'New Attachment',
    style, // linear | area | count | attachment
    type: 'General',
    layerId: null,
    color,
    lineWidth: 2,
    // Fill / hatch for area (and optional linear band)
    // solid | transparent | hatch | crosshatch | diamond | dots | lines-h | lines-v
    fillPattern: 'solid',
    fillOpacity: 0.22,
    height: style === 'linear' ? 8 : 0, // ft
    thickness: style === 'area' ? 0.333 : 0, // ft (~4")
    width: 0,
    depth: 0,
    // results flags
    resultPrimary: style === 'linear' ? 'length' : style === 'area' ? 'area' : 'count',
    resultSecondary: style === 'linear' ? 'surface' : style === 'area' ? 'volume' : null,
    unitPrimary: style === 'linear' ? 'LF' : style === 'area' ? 'SF' : 'EA',
    unitSecondary: style === 'linear' ? 'SF' : style === 'area' ? 'CF' : null,
    notes: '',
    // estimate unit costs
    materialUnitCost: 0,
    laborUnitCost: 0,
    subUnitCost: 0,
    costUnit: null, // defaults to unitPrimary
    // Paint system assembly lines (primer, coats, etc.)
    assemblies: [],
    // Room package role tag (ceiling|walls|base|…)
    roomRole: null,
    ...overrides,
  };
  return base;
}

function createPage(overrides = {}) {
  return {
    id: uid(),
    name: 'Page 1',
    pageNumber: 1,
    imageDataUrl: null, // base64 or object URL stored as data URL
    imageWidth: 0,
    imageHeight: 0,
    // scale: world feet per image pixel
    scaleId: '1/4',
    feetPerPixel: null, // computed from scale + DPI or calibration
    calibrated: false,
    dpi: 96, // assumed when loading raster
    notes: '',
    ...overrides,
  };
}

function createTakeoffObject(conditionId, kind, geometry, overrides = {}) {
  return {
    id: uid(),
    conditionId,
    kind, // segment | polyline | polygon | point | deduction
    pageId: null,
    geometry, // points: [{x,y},...] in image pixel space
    label: '',
    // Typical / unit multiplier (e.g. 12 identical rooms)
    multiplier: 1,
    // Opening/deduction: subtracts from parent area/linear parent
    parentId: null,
    isDeduction: false,
    // Room package meta
    roomPackageId: null,
    role: null, // ceiling | walls | base | crown | chair | wainscot | floor | opening | other
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Paint system line inside an assembly (expanded on Estimate). */
function createAssemblyLine(overrides = {}) {
  return {
    id: uid(),
    description: 'Finish coat',
    // qtyMode: same | surface | length | count | fixed
    qtyMode: 'same',
    factor: 1, // e.g. 2 coats
    unit: '',
    materialUnitCost: 0,
    laborUnitCost: 0,
    ...overrides,
  };
}

/**
 * Default room package for painting — applied when user finishes a room outline.
 * Perimeter of floor/ceiling polygon drives walls, base, crown, chair rail.
 */
function defaultRoomPackage() {
  return {
    wallHeight: 9,
    ceiling: true,
    floor: false,
    walls: true,
    base: true,
    crown: false,
    chairRail: false,
    chairRailHeight: 3, // ft above floor (info only)
    wainscot: false,
    wainscotHeight: 3.5, // ft — SF = perimeter × height
    doorOpenings: true, // allow deductions
    windowOpenings: true,
    // unit costs defaults (painting-ish)
    costs: {
      ceiling: { mat: 0.28, lab: 0.7 },
      walls: { mat: 0.32, lab: 0.85 },
      floor: { mat: 0.2, lab: 0.5 },
      base: { mat: 0.12, lab: 1.1 },
      crown: { mat: 0.15, lab: 1.4 },
      chair: { mat: 0.12, lab: 1.2 },
      wainscot: { mat: 0.35, lab: 0.9 },
    },
  };
}

function createProject(overrides = {}) {
  const layers = DEFAULT_LAYERS();
  return {
    id: uid(),
    name: 'Untitled Bid',
    jobNumber: '',
    status: 'Bidding',
    client: '',
    location: '',
    estimator: '',
    bidDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    architect: '',
    description: '',
    // link to WL Estimates folder on disk
    folderPath: '',
    drawingsFolder: '',
    estimatesFolder: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // cover sheet fields
    cover: {
      company: '',
      contact: '',
      phone: '',
      email: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      bidType: 'Base Bid',
      notes: '',
      workflowStatus: 'Draft',
    },
    layers,
    conditions: [],
    pages: [],
    takeoffs: [], // all drawn objects
    zones: [],
    // worksheet line items (manual adjustments / assemblies)
    worksheet: [],
    // budget tracking
    budget: {
      totalBudget: 0,
      contingencyPct: 5,
      lines: [],
    },
    notes: [],
    // UI prefs per project
    activePageId: null,
    activeConditionId: null,
    // On-plan measurement labels (segment LF / area SF)
    showSegmentLabels: true,
    showObjectTotals: true,
    // Painting room package defaults
    roomPackage: defaultRoomPackage(),
    // AI scope proposal draft
    scopeProposal: {
      text: '',
      checklist: [],
      lastRun: null,
      model: '',
    },
    ...overrides,
  };
}

const FILL_PATTERNS = [
  { id: 'solid', label: 'Solid fill' },
  { id: 'transparent', label: 'Outline only' },
  { id: 'hatch', label: 'Diagonal hatch' },
  { id: 'crosshatch', label: 'Crosshatch' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'dots', label: 'Dots' },
  { id: 'lines-h', label: 'Horizontal lines' },
  { id: 'lines-v', label: 'Vertical lines' },
];

function createWorksheetLine(overrides = {}) {
  return {
    id: uid(),
    code: '',
    description: '',
    quantity: 0,
    unit: 'EA',
    material: 0,
    labor: 0,
    equipment: 0,
    other: 0,
    ...overrides,
  };
}

function createNote(overrides = {}) {
  return {
    id: uid(),
    title: 'Note',
    body: '',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Convert feet-per-drawing-inch to feet-per-pixel given image DPI.
 * At 1/4" = 1'-0", one drawing inch = 4 feet; at 96 DPI, 96 px = 1 inch.
 */
function feetPerPixelFromScale(scaleId, dpi = 96, customFeetPerInch = null) {
  const preset = PRESET_SCALES.find((s) => s.id === scaleId);
  const fpi = scaleId === 'custom' ? customFeetPerInch : preset?.feetPerInch;
  if (!fpi || !dpi) return null;
  return fpi / dpi;
}

function distancePx(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function polylineLengthPx(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += distancePx(points[i - 1], points[i]);
  return len;
}

function polygonAreaPx(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

function computeObjectQuantity(obj, condition, page) {
  const fpp = page?.feetPerPixel;
  const mult = Math.max(0, Number(obj.multiplier) || 1);
  if (!fpp && condition?.style !== 'count' && obj.kind !== 'point') {
    return { primary: 0, secondary: 0, unscaled: true, multiplier: mult };
  }
  const pts = obj.geometry?.points || [];
  let primary = 0;
  let secondary = 0;

  if (obj.kind === 'point' || condition?.style === 'count') {
    primary = 1;
  } else if (obj.kind === 'segment' || obj.kind === 'polyline' || condition?.style === 'linear') {
    const lenFt = polylineLengthPx(pts) * fpp;
    const height = condition?.height || 0;
    primary = lenFt;
    secondary = lenFt * height;
  } else if (obj.kind === 'polygon' || obj.kind === 'deduction' || condition?.style === 'area') {
    const areaSf = polygonAreaPx(pts) * fpp * fpp;
    const thickness = condition?.thickness || 0;
    primary = areaSf;
    secondary = areaSf * thickness;
  }

  // Deductions are stored as positive geometry but counted negative when applied to parent
  if (obj.isDeduction) {
    primary = -Math.abs(primary);
    secondary = -Math.abs(secondary);
  }

  primary *= mult;
  secondary *= mult;
  return { primary, secondary, unscaled: false, multiplier: mult };
}

/**
 * Gross quantity for a takeoff before child deductions (still includes multiplier).
 */
function computeGrossQuantity(obj, condition, page) {
  const clone = { ...obj, isDeduction: false };
  return computeObjectQuantity(clone, condition, page);
}

/**
 * Net quantity: own qty + all child deductions (openings) attached to this mark.
 */
function computeNetObjectQuantity(project, obj, condition, page) {
  const base = computeObjectQuantity(obj, condition, page);
  if (obj.isDeduction) return base;
  let primary = base.primary;
  let secondary = base.secondary;
  for (const child of project.takeoffs || []) {
    if (child.parentId !== obj.id) continue;
    const cCond =
      project.conditions.find((c) => c.id === child.conditionId) || condition;
    const pageC = project.pages.find((p) => p.id === child.pageId) || page;
    // Child deduction geometry always subtracts from parent surface
    const cq = computeObjectQuantity(
      { ...child, isDeduction: true },
      cCond?.style === 'area' || child.kind === 'polygon'
        ? { ...cCond, style: 'area' }
        : cCond,
      pageC
    );
    // Openings on walls: if parent is linear (walls as LF×height surface), deduct SF from secondary
    if (condition?.style === 'linear' || obj.kind === 'polyline' || obj.kind === 'segment') {
      // Deduct opening area from wall surface (secondary), not length
      const openingSf = Math.abs(cq.primary);
      secondary -= openingSf * (Math.max(0, Number(child.multiplier) || 1));
    } else {
      primary += cq.primary; // already negative if isDeduction
      secondary += cq.secondary;
    }
  }
  primary = Math.max(0, primary);
  secondary = Math.max(0, secondary);
  return {
    primary,
    secondary,
    unscaled: base.unscaled,
    multiplier: base.multiplier,
    gross: base.primary,
  };
}

function aggregateConditionQuantities(project, conditionId) {
  const condition = project.conditions.find((c) => c.id === conditionId);
  if (!condition) return { primary: 0, secondary: 0, count: 0, deducted: 0 };

  let primary = 0;
  let secondary = 0;
  let count = 0;
  let deducted = 0;
  for (const t of project.takeoffs) {
    if (t.conditionId !== conditionId) continue;
    // Child-only deductions also list under their own condition sometimes —
    // skip pure deduction objects that only exist as children of another mark
    // unless they are assigned to this condition as openings to sum separately.
    if (t.isDeduction && t.parentId) {
      // counted via parent net; optional: track deducted total
      const page = project.pages.find((p) => p.id === t.pageId);
      const q = computeObjectQuantity(t, condition, page);
      deducted += Math.abs(q.primary);
      count += 1;
      continue;
    }
    const page = project.pages.find((p) => p.id === t.pageId);
    const q = computeNetObjectQuantity(project, t, condition, page);
    primary += q.primary;
    secondary += q.secondary;
    deducted += Math.max(0, (q.gross || 0) - q.primary);
    count += 1;
  }
  return { primary, secondary, count, deducted };
}

/**
 * Resolve assembly takeoff quantity from condition aggregates.
 * qtyMode: same | surface | length | count | fixed
 */
function assemblyQty(q, condition, assembly) {
  const mode = assembly.qtyMode || 'same';
  let qty = 0;
  let unit = assembly.unit || '';
  if (mode === 'surface') {
    // Wall SF from LF × height (secondary); fall back to primary if area condition
    qty = Number(q.secondary) > 0 ? q.secondary : q.primary;
    unit = unit || condition.unitSecondary || 'SF';
  } else if (mode === 'length') {
    qty = q.primary;
    unit = unit || (condition.style === 'linear' ? 'LF' : condition.unitPrimary || 'LF');
  } else if (mode === 'count') {
    qty = q.count;
    unit = unit || 'EA';
  } else if (mode === 'fixed') {
    qty = 1;
    unit = unit || 'LS';
  } else {
    // same = primary takeoff unit
    qty = q.primary;
    unit = unit || condition.unitPrimary || '';
  }
  const factor = Number(assembly.factor);
  qty *= Number.isFinite(factor) && factor > 0 ? factor : 1;
  return { qty, unit };
}

/**
 * Expand conditions into assembly line items for Estimate tab.
 * Each assembly line multiplies qty by factor (e.g. 2 coats).
 */
function expandEstimateLines(project) {
  const lines = [];
  for (const c of project.conditions || []) {
    const q = aggregateConditionQuantities(project, c.id);
    const assemblies = c.assemblies || [];
    if (!assemblies.length) {
      const mat = q.primary * (c.materialUnitCost || 0);
      const lab = q.primary * (c.laborUnitCost || 0);
      const sub = q.primary * (c.subUnitCost || 0);
      lines.push({
        section: 'takeoff',
        conditionId: c.id,
        number: c.number,
        name: c.name,
        qty: q.primary,
        unit: c.unitPrimary || '',
        materialUnitCost: c.materialUnitCost || 0,
        laborUnitCost: c.laborUnitCost || 0,
        equipmentUnitCost: 0,
        otherUnitCost: 0,
        subUnitCost: c.subUnitCost || 0,
        material: mat,
        labor: lab,
        equipment: 0,
        other: 0,
        sub,
        total: mat + lab + sub,
        isAssembly: false,
        qtyMode: 'same',
      });
      continue;
    }
    for (const a of assemblies) {
      const { qty, unit } = assemblyQty(q, c, a);
      const matU = Number(a.materialUnitCost) || 0;
      const labU = Number(a.laborUnitCost) || 0;
      const eqU = Number(a.equipmentUnitCost) || 0;
      const othU = Number(a.otherUnitCost) || 0;
      const mat = qty * matU;
      const lab = qty * labU;
      const equipment = qty * eqU;
      const other = qty * othU;
      lines.push({
        section: 'takeoff',
        conditionId: c.id,
        number: c.number,
        name: `${c.name} — ${a.description}`,
        qty,
        unit,
        materialUnitCost: matU,
        laborUnitCost: labU,
        equipmentUnitCost: eqU,
        otherUnitCost: othU,
        subUnitCost: 0,
        material: mat,
        labor: lab,
        equipment,
        other,
        sub: 0,
        total: mat + lab + equipment + other,
        isAssembly: true,
        assemblyId: a.id,
        qtyMode: a.qtyMode || 'same',
        factor: a.factor || 1,
      });
    }
  }
  return lines;
}

/**
 * Worksheet / gear lines as estimate rows (mobilization, sprayers, barriers, etc.).
 * Ext = qty × (material + labor + equipment + other) when those are unit costs,
 * or if qty is 1 and values are already lump sums, same formula works.
 */
function expandWorksheetLines(project) {
  const lines = [];
  for (const w of project.worksheet || []) {
    const qty = Number(w.quantity) || 0;
    const matU = Number(w.material) || 0;
    const labU = Number(w.labor) || 0;
    const eqU = Number(w.equipment) || 0;
    const othU = Number(w.other) || 0;
    const mat = qty * matU;
    const lab = qty * labU;
    const equipment = qty * eqU;
    const other = qty * othU;
    lines.push({
      section: 'gear',
      worksheetId: w.id,
      number: w.code || '',
      name: w.description || 'Worksheet line',
      qty,
      unit: w.unit || 'LS',
      materialUnitCost: matU,
      laborUnitCost: labU,
      equipmentUnitCost: eqU,
      otherUnitCost: othU,
      subUnitCost: 0,
      material: mat,
      labor: lab,
      equipment,
      other,
      sub: 0,
      total: mat + lab + equipment + other,
      isAssembly: false,
      isWorksheet: true,
    });
  }
  return lines;
}

/**
 * Full estimate rollup: takeoff assemblies + gear/supplies worksheet.
 */
function buildFullEstimate(project, opts = {}) {
  const hideZero = !!opts.hideZero;
  const takeoffAll = expandEstimateLines(project);
  const gearAll = expandWorksheetLines(project);

  // Hide assembly rows only when takeoff qty is zero (no digitizing yet)
  const takeoffFiltered = hideZero
    ? takeoffAll.filter((l) => Number(l.qty) > 0)
    : takeoffAll;

  // Always include gear/supply lines that have any cost or qty (suite packages)
  const gearLines = hideZero
    ? gearAll.filter((l) => Number(l.qty) > 0 && Number(l.total) !== 0)
    : gearAll;

  const sum = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

  const takeoff = {
    material: sum(takeoffFiltered, 'material'),
    labor: sum(takeoffFiltered, 'labor'),
    equipment: sum(takeoffFiltered, 'equipment'),
    other: sum(takeoffFiltered, 'other'),
    sub: sum(takeoffFiltered, 'sub'),
  };
  takeoff.total =
    takeoff.material + takeoff.labor + takeoff.equipment + takeoff.other + takeoff.sub;

  const gear = {
    material: sum(gearLines, 'material'),
    labor: sum(gearLines, 'labor'),
    equipment: sum(gearLines, 'equipment'),
    other: sum(gearLines, 'other'),
    sub: 0,
  };
  gear.total = gear.material + gear.labor + gear.equipment + gear.other;

  const totals = {
    material: takeoff.material + gear.material,
    labor: takeoff.labor + gear.labor,
    equipment: takeoff.equipment + gear.equipment,
    other: takeoff.other + gear.other,
    sub: takeoff.sub + gear.sub,
  };
  totals.grand =
    totals.material + totals.labor + totals.equipment + totals.other + totals.sub;

  return {
    takeoffLines: takeoffFiltered,
    gearLines,
    takeoff,
    gear,
    totals,
  };
}

/**
 * Ensure painting conditions exist for room package roles; return map role → condition.
 */
function ensureRoomConditions(project, pkg) {
  const roles = [];
  if (pkg.ceiling) roles.push({ role: 'ceiling', style: 'area', name: 'Ceiling paint', type: 'Finishes', color: '#3498db' });
  if (pkg.floor) roles.push({ role: 'floor', style: 'area', name: 'Floor paint', type: 'Finishes', color: '#95a5a6' });
  if (pkg.walls) roles.push({ role: 'walls', style: 'linear', name: 'Wall paint', type: 'Finishes', color: '#e74c3c', height: pkg.wallHeight || 9 });
  if (pkg.base) roles.push({ role: 'base', style: 'linear', name: 'Base / shoe', type: 'Finishes', color: '#9b59b6', height: 0.33 });
  if (pkg.crown) roles.push({ role: 'crown', style: 'linear', name: 'Crown molding', type: 'Finishes', color: '#8e44ad', height: 0.4 });
  if (pkg.chairRail) roles.push({ role: 'chair', style: 'linear', name: 'Chair rail', type: 'Finishes', color: '#f39c12', height: 0.25 });
  if (pkg.wainscot) roles.push({ role: 'wainscot', style: 'linear', name: 'Wainscot', type: 'Finishes', color: '#1abc9c', height: pkg.wainscotHeight || 3.5 });
  roles.push({ role: 'opening', style: 'area', name: 'Opening deduction', type: 'Doors & Windows', color: '#e74c3c', fillPattern: 'hatch' });

  const map = {};
  const layerId = project.layers[0]?.id || null;
  for (const r of roles) {
    let c = project.conditions.find((x) => x.roomRole === r.role);
    if (!c) {
      const costs = (pkg.costs && pkg.costs[r.role]) || {};
      c = createCondition(r.style, {
        number: nextConditionNumber(project),
        name: r.name,
        type: r.type || 'Finishes',
        layerId,
        color: r.color,
        height: r.height || 0,
        fillPattern: r.fillPattern || 'solid',
        materialUnitCost: costs.mat || 0,
        laborUnitCost: costs.lab || 0,
        roomRole: r.role,
        // Default 2-coat assembly for paint surfaces
        assemblies:
          r.role === 'walls' || r.role === 'ceiling' || r.role === 'wainscot'
            ? [
                createAssemblyLine({
                  description: 'Primer',
                  qtyMode: r.style === 'linear' ? 'surface' : 'same',
                  factor: 1,
                  materialUnitCost: (costs.mat || 0) * 0.4,
                  laborUnitCost: (costs.lab || 0) * 0.35,
                }),
                createAssemblyLine({
                  description: 'Finish coats (×2)',
                  qtyMode: r.style === 'linear' ? 'surface' : 'same',
                  factor: 2,
                  materialUnitCost: costs.mat || 0,
                  laborUnitCost: costs.lab || 0,
                }),
              ]
            : [],
      });
      project.conditions.push(c);
    } else if (r.role === 'walls' && pkg.wallHeight) {
      c.height = pkg.wallHeight;
    } else if (r.role === 'wainscot' && pkg.wainscotHeight) {
      c.height = pkg.wainscotHeight;
    }
    map[r.role] = c;
  }
  return map;
}

/**
 * From a floor-plan polygon (image px), create room package takeoffs.
 * Returns created takeoff objects (not yet pushed).
 */
function buildRoomPackageTakeoffs(project, page, polygonPoints, pkg, opts = {}) {
  const mult = Math.max(1, Number(opts.multiplier) || 1);
  const packageId = uid();
  const map = ensureRoomConditions(project, pkg);
  const fpp = page.feetPerPixel;
  if (!fpp || polygonPoints.length < 3) return { packageId, objects: [], error: 'Need scale + 3 points' };

  const areaSf = polygonAreaPx(polygonPoints) * fpp * fpp;
  const periLf = polylineLengthPx([...polygonPoints, polygonPoints[0]]) * fpp;
  const objects = [];
  const baseGeom = { points: polygonPoints.map((p) => ({ x: p.x, y: p.y })) };

  const add = (role, kind, geom, extra = {}) => {
    const cond = map[role];
    if (!cond) return;
    objects.push(
      createTakeoffObject(cond.id, kind, geom, {
        pageId: page.id,
        multiplier: mult,
        roomPackageId: packageId,
        role,
        label: opts.roomName || 'Room',
        ...extra,
      })
    );
  };

  if (pkg.ceiling) add('ceiling', 'polygon', baseGeom);
  if (pkg.floor) add('floor', 'polygon', baseGeom);
  // Walls / trim use perimeter as linear along room outline
  const loop = { points: [...polygonPoints.map((p) => ({ x: p.x, y: p.y })), { ...polygonPoints[0] }] };
  // store without duplicate close point for polyline length
  const wallPts = { points: polygonPoints.map((p) => ({ x: p.x, y: p.y })) };
  // For closed room, perimeter = closed ring
  const closed = {
    points: [...polygonPoints.map((p) => ({ x: p.x, y: p.y })), { x: polygonPoints[0].x, y: polygonPoints[0].y }],
  };
  if (pkg.walls) add('walls', 'polyline', closed);
  if (pkg.base) add('base', 'polyline', closed);
  if (pkg.crown) add('crown', 'polyline', closed);
  if (pkg.chairRail) add('chair', 'polyline', closed);
  if (pkg.wainscot) add('wainscot', 'polyline', closed);

  return {
    packageId,
    objects,
    metrics: { areaSf, periLf, wallSf: periLf * (pkg.wallHeight || 9), multiplier: mult },
    conditions: map,
  };
}

function formatQty(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function nextConditionNumber(project) {
  const nums = project.conditions.map((c) => c.number || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/** Drawing-style feet-and-inches: 12.51 → "12′ 6″" (ported from OpenTakeoff units.ts). */
function ftIn(feet) {
  if (!Number.isFinite(feet)) return '';
  const sign = feet < 0 ? '-' : '';
  let ft = Math.floor(Math.abs(feet) + 1e-9);
  let inch = Math.round((Math.abs(feet) - ft) * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return `${sign}${ft}′ ${inch}″`;
}

/**
 * Parse typed length to feet. Accepts "12.5", "12'6", "12-6", "6\"", etc.
 * (ported / simplified from OpenTakeoff units.ts)
 */
function parseLenInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  const plainNum = (t) => (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t) ? Number(t) : NaN);
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|″|”|in)$/i);
  if (inOnly) return Number(inOnly[1]) / 12;
  const fi =
    s.match(/^(\d+(?:\.\d+)?)\s*(?:'|′|’|ft)\s*(?:-|\s)?\s*(\d+(?:\.\d+)?)?\s*(?:"|″|”|in)?$/i) ||
    s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (fi) {
    const ft = Number(fi[1]);
    const inch = fi[2] != null ? Number(fi[2]) : 0;
    if (!Number.isFinite(ft) || !Number.isFinite(inch) || inch >= 12) return NaN;
    return ft + inch / 12;
  }
  return plainNum(s);
}

/** Check-scale error grade: |shown| ≤1% match, ≤5% close, else wrong. */
function checkVerdict(errPct) {
  if (!Number.isFinite(errPct)) return { shown: 0, grade: 'wrong' };
  const shown = Number(errPct.toFixed(1)) || 0;
  const a = Math.abs(shown);
  return { shown, grade: a <= 1 ? 'match' : a <= 5 ? 'close' : 'wrong' };
}

/**
 * Polar tracking: lock next segment to 45° family (sheet axes).
 * last/cur are {x,y}. force=true (Shift) locks at any angle.
 * Returns { pt:{x,y}, deg } or null. (from OpenTakeoff geometry.js angleSnap)
 */
const ANGLE_TOL = 4;
function angleSnap(last, cur, force) {
  const dx = cur.x - last.x;
  const dy = cur.y - last.y;
  if (!dx && !dy) return null;
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
  const snapped = Math.round(theta / 45) * 45;
  if (!force && Math.abs(theta - snapped) > ANGLE_TOL) return null;
  const rad = (snapped * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const d = dx * ux + dy * uy;
  return {
    pt: { x: last.x + d * ux, y: last.y + d * uy },
    deg: ((snapped % 180) + 180) % 180,
  };
}

// Export for browser global
window.PTModels = {
  uid,
  PRESET_SCALES,
  CONDITION_COLORS,
  CONDITION_TYPES,
  FILL_PATTERNS,
  DEFAULT_LAYERS,
  createLayer,
  createCondition,
  createPage,
  createTakeoffObject,
  createAssemblyLine,
  defaultRoomPackage,
  createProject,
  createWorksheetLine,
  createNote,
  feetPerPixelFromScale,
  distancePx,
  polylineLengthPx,
  polygonAreaPx,
  computeObjectQuantity,
  computeGrossQuantity,
  computeNetObjectQuantity,
  aggregateConditionQuantities,
  expandEstimateLines,
  expandWorksheetLines,
  assemblyQty,
  buildFullEstimate,
  ensureRoomConditions,
  buildRoomPackageTakeoffs,
  formatQty,
  nextConditionNumber,
  ftIn,
  parseLenInput,
  checkVerdict,
  ANGLE_TOL,
  angleSnap,
};

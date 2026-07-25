/**
 * Persistence layer
 * - Metadata + takeoffs → localStorage (small)
 * - Plan images (data URLs) → IndexedDB (large; avoids quota errors)
 */

const STORE_KEY = 'planTakeoff.v1'; // legacy fat blob (migrated away)
const META_KEY = 'planTakeoff.v1.meta';
const IDB_NAME = 'PlanTakeoffDB';
const IDB_VERSION = 1;
const IDB_STORE = 'pageImages';

const defaultAppState = () => ({
  version: 1,
  projects: [],
  activeProjectId: null,
  visibleOptionalTabs: {
    // Core: library → takeoff → summary → estimate. Optional tabs off.
    folders: false,
    cover: false,
    worksheet: false,
    budget: false,
    notes: false,
    resources: false,
  },
  lastTab: 'library',
});

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error || new Error('IndexedDB open failed'));
    };
  });
  return _dbPromise;
}

function imageKey(projectId, pageId) {
  return `${projectId}::${pageId}`;
}

function idbPutMany(entries) {
  if (!entries.length) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        for (const [key, value] of entries) {
          if (value) store.put(value, key);
          else store.delete(key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function idbGet(key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbGetAllKeys() {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbDeleteKeys(keys) {
  if (!keys.length) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        for (const k of keys) store.delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

/** Collect live image map from in-memory state. */
function collectImages(state) {
  const map = new Map();
  for (const proj of state.projects || []) {
    for (const page of proj.pages || []) {
      const key = imageKey(proj.id, page.id);
      if (page.imageDataUrl) map.set(key, page.imageDataUrl);
    }
  }
  return map;
}

/** Clone state for localStorage without base64 plan payloads. */
function metaClone(state) {
  const s = JSON.parse(JSON.stringify(state));
  for (const proj of s.projects || []) {
    for (const page of proj.pages || []) {
      if (page.imageDataUrl) {
        page.hasImage = true;
        page.imageDataUrl = null;
      } else if (page.hasImage == null) {
        page.hasImage = false;
      }
    }
  }
  return s;
}

/**
 * Compress a plan data URL to JPEG to cut size ~5–10× vs PNG.
 * White background so transparency does not go black.
 */
function compressPlanDataUrl(dataUrl, quality = 0.82, maxEdge = 4500) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
      resolve(dataUrl);
      return;
    }
    // Already small-ish JPEG
    if (dataUrl.startsWith('data:image/jpeg') && dataUrl.length < 2_500_000) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(dataUrl);
          return;
        }
        if (Math.max(w, h) > maxEdge) {
          const scale = maxEdge / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        // Prefer smaller payload
        resolve(jpeg.length < dataUrl.length ? jpeg : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function hydrateImages(state) {
  for (const proj of state.projects || []) {
    await hydrateProjectImages(proj);
  }
  return state;
}

/** Reload plan images for one job from IndexedDB (after open / refresh). */
async function hydrateProjectImages(project) {
  if (!project?.pages?.length) return project;
  for (const page of project.pages) {
    if (page.imageDataUrl) {
      page.hasImage = true;
      continue;
    }
    try {
      const data = await idbGet(imageKey(project.id, page.id));
      if (data) {
        page.imageDataUrl = data;
        page.hasImage = true;
      }
    } catch (e) {
      console.warn('IDB image load failed', page.id, e);
    }
  }
  return project;
}

/**
 * Load app state. Async — images come from IndexedDB.
 */
async function loadState() {
  let data = null;
  let migratedFromLegacy = false;

  try {
    const metaRaw = localStorage.getItem(META_KEY);
    if (metaRaw) {
      data = JSON.parse(metaRaw);
    } else {
      // Legacy: everything (including huge plan data URLs) lived in one key
      let legacy = null;
      try {
        legacy = localStorage.getItem(STORE_KEY);
      } catch (e) {
        console.warn('Could not read legacy storage', e);
      }
      if (legacy) {
        try {
          data = JSON.parse(legacy);
          migratedFromLegacy = true;
        } catch (e) {
          console.warn('Legacy state corrupt', e);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to parse stored state', e);
  }

  if (!data) return defaultAppState();

  const state = { ...defaultAppState(), ...data, version: 1 };

  try {
    await hydrateImages(state);
  } catch (e) {
    console.warn('Image hydrate failed (plans may be missing)', e);
  }

  // One-time migration: fat localStorage → meta + IDB
  // Remove fat key FIRST so localStorage has room for meta (often already at quota).
  if (migratedFromLegacy) {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    try {
      await saveState(state);
    } catch (e) {
      console.warn('Migration save failed', e);
      // Keep in-memory state even if first save fails — user can retry by drawing/saving
    }
  } else {
    // Always drop leftover fat key if meta already exists (frees quota)
    try {
      if (localStorage.getItem(STORE_KEY) != null) localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  return state;
}

/** Sync fallback used only if something still expects sync load (returns meta without images). */
function loadStateSync() {
  try {
    const raw = localStorage.getItem(META_KEY) || localStorage.getItem(STORE_KEY);
    if (!raw) return defaultAppState();
    const data = JSON.parse(raw);
    return { ...defaultAppState(), ...data, version: 1 };
  } catch (e) {
    console.warn('Failed to load state', e);
    return defaultAppState();
  }
}

/**
 * Persist state: small meta in localStorage, plan images in IndexedDB.
 */
async function saveState(state) {
  const images = collectImages(state);
  const meta = metaClone(state);

  // Mark hasImage flags on live state pages too
  for (const proj of state.projects || []) {
    for (const page of proj.pages || []) {
      page.hasImage = !!page.imageDataUrl;
    }
  }

  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    // Drop legacy fat key so it no longer eats quota
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error('Meta save failed', e);
    throw new Error(
      'Could not save project metadata. Try closing other tabs or clearing site data for this app.'
    );
  }

  try {
    const entries = [...images.entries()];
    await idbPutMany(entries);

    // Prune orphaned image keys (deleted pages/projects)
    const live = new Set(images.keys());
    const allKeys = await idbGetAllKeys();
    const orphans = allKeys.filter((k) => typeof k === 'string' && k.includes('::') && !live.has(k));
    if (orphans.length) await idbDeleteKeys(orphans);
  } catch (e) {
    console.error('Image save failed', e);
    throw new Error(
      'Could not save plan images. Disk may be full, or browser storage is blocked. ' +
        'Export a JSON backup, then try again.'
    );
  }
}

function exportStateJson(state) {
  // Full dump including images for backup / transfer
  return JSON.stringify(state, null, 2);
}

function importStateJson(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object') throw new Error('Invalid file');
  return { ...defaultAppState(), ...data, version: 1 };
}

function getActiveProject(state) {
  if (!state.activeProjectId) return null;
  return state.projects.find((p) => p.id === state.activeProjectId) || null;
}

function touchProject(project) {
  project.updatedAt = new Date().toISOString();
  return project;
}

function ensureSampleIfEmpty(state) {
  if (state.projects.length > 0) return state;
  const M = window.PTModels;
  const project = M.createProject({
    name: 'Sample Office Remodel',
    jobNumber: 'BID-2026-001',
    client: 'Acme Properties',
    location: 'Austin, TX',
    estimator: 'You',
    status: 'Bidding',
    description: 'Demo bid with sample conditions. Import your own PDF/PNG plans on the Takeoff tab.',
  });
  project.cover.company = 'Your Company LLC';
  project.cover.workflowStatus = 'In Progress';

  const arch = project.layers[0];
  const struct = project.layers[1];
  const mep = project.layers[2];

  const walls = M.createCondition('linear', {
    number: 1,
    name: 'Interior Partition 8\'',
    type: 'Wood',
    layerId: arch.id,
    color: '#e74c3c',
    height: 8,
    materialUnitCost: 12.5,
    laborUnitCost: 18,
  });
  const floor = M.createCondition('area', {
    number: 2,
    name: 'Carpet Flooring',
    type: 'Finishes',
    layerId: arch.id,
    color: '#3498db',
    thickness: 0,
    materialUnitCost: 3.25,
    laborUnitCost: 1.5,
  });
  const lights = M.createCondition('count', {
    number: 3,
    name: '2x4 LED Fixture',
    type: 'Electrical',
    layerId: mep.id,
    color: '#f1c40f',
    materialUnitCost: 85,
    laborUnitCost: 45,
  });
  const slab = M.createCondition('area', {
    number: 4,
    name: '4" Slab on Grade',
    type: 'Concrete',
    layerId: struct.id,
    color: '#95a5a6',
    thickness: 4 / 12,
    materialUnitCost: 6.5,
    laborUnitCost: 4,
  });
  project.conditions = [walls, floor, lights, slab];

  const page = M.createPage({
    name: 'A1.01 Floor Plan',
    pageNumber: 1,
    scaleId: '1/4',
    feetPerPixel: M.feetPerPixelFromScale('1/4', 96),
  });
  project.pages = [page];
  project.activePageId = page.id;
  project.activeConditionId = walls.id;

  project.worksheet = [
    M.createWorksheetLine({
      code: '01-100',
      description: 'General conditions / supervision',
      quantity: 1,
      unit: 'LS',
      labor: 2500,
    }),
  ];
  project.notes = [
    M.createNote({
      title: 'Welcome',
      body: 'Open the Takeoff tab, load a plan image/PDF page, set scale, then draw with the selected condition.',
    }),
  ];
  project.budget = {
    totalBudget: 150000,
    contingencyPct: 5,
    lines: [],
  };

  state.projects.push(project);
  return state;
}

/** Best-effort clear of legacy fat localStorage key (frees quota). */
function clearLegacyFatStorage() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

window.PTStore = {
  STORE_KEY,
  META_KEY,
  defaultAppState,
  loadState,
  loadStateSync,
  saveState,
  exportStateJson,
  importStateJson,
  getActiveProject,
  touchProject,
  ensureSampleIfEmpty,
  compressPlanDataUrl,
  clearLegacyFatStorage,
  hydrateProjectImages,
  imageKey,
};

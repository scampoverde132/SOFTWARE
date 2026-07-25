/**
 * PlanTakeoff main application controller
 */
(function () {
  const M = window.PTModels;
  const Store = window.PTStore;

  // Loaded async on init (IndexedDB images). Placeholder until then.
  let state = Store.defaultAppState();
  let selectedProjectId = null;
  let editingConditionId = null;
  /** Snapshot for Cancel after live color preview in Condition Properties */
  let _condEditSnapshot = null;
  let calibratePx = 0;
  let selectedWorksheetLineId = null;
  let planCanvas = null;
  const Hist = window.PTHistory;
  let _saveTimer = null;
  let _saveBusy = false;
  let _saveQueued = false;

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /** Debounced async save — plan images go to IndexedDB, not localStorage. */
  function save(immediate = false) {
    if (immediate) {
      if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
      }
      return flushSave();
    }
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      flushSave();
    }, 200);
  }

  async function flushSave() {
    if (_saveBusy) {
      _saveQueued = true;
      return;
    }
    _saveBusy = true;
    try {
      await Store.saveState(state);
    } catch (e) {
      console.error(e);
      alert(
        (e && e.message) ||
          'Could not save project data. Plan images are large — try closing other PlanTakeoff windows, or Export JSON as a backup.'
      );
    } finally {
      _saveBusy = false;
      if (_saveQueued) {
        _saveQueued = false;
        flushSave();
      }
    }
  }

  function project() {
    return Store.getActiveProject(state);
  }

  function activePage() {
    const p = project();
    if (!p) return null;
    return p.pages.find((x) => x.id === p.activePageId) || p.pages[0] || null;
  }

  function activeCondition() {
    const p = project();
    if (!p) return null;
    return p.conditions.find((x) => x.id === p.activeConditionId) || p.conditions[0] || null;
  }

  /** Unique page title — auto-names from file/PDF without colliding. */
  function nextPageName(proj, baseName) {
    let base = String(baseName || 'Page')
      .replace(/\.[^.\\/]+$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!base) base = 'Page';
    if (base.length > 72) base = base.slice(0, 69) + '…';
    const existing = new Set((proj.pages || []).map((pg) => (pg.name || '').toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    let i = 2;
    while (existing.has(`${base} (${i})`.toLowerCase())) i += 1;
    return `${base} (${i})`;
  }

  /**
   * Parse sheet number from filename (mirrors server classify).
   * "A101 EXISTING SHELL _ NEW WORK PLANS.pdf" → { sheetId: "A101", pageLabel: "A101 — EXISTING SHELL…" }
   */
  function parseSheetFromFilename(fileName) {
    const stem = String(fileName || 'Drawing')
      .replace(/\.[^.\\/]+$/i, '')
      .replace(/[—–]/g, '-')
      .trim();
    const lead = stem.match(
      /^([A-Za-z]{1,3}[\s-]?\d{1,3}(?:\.\d{1,2})?|\d{2,4}|FP[\s-]?\d{1,3})\b[\s_-]*(.*)$/i
    );
    let sheetId = '';
    let title = stem;
    if (lead) {
      sheetId = lead[1].toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');
      sheetId = sheetId.replace(/^([A-Z]+)[\s-]?(\d)/, '$1$2');
      title = (lead[2] || '')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*drawing\s*title\s*$/i, '')
        .trim();
    }
    const pageLabel = sheetId
      ? title
        ? `${sheetId} — ${title}`.slice(0, 100)
        : sheetId
      : stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    return { sheetId, title, pageLabel };
  }

  function nameFromPlanFile(fileName, pageNum, pageCount, drawingMeta) {
    // Prefer server-provided sheet label
    let base =
      (drawingMeta && (drawingMeta.page_label || drawingMeta.sheet_id)) ||
      parseSheetFromFilename(fileName).pageLabel ||
      String(fileName || 'Plan').replace(/\.[^.\\/]+$/i, '');
    base = String(base)
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Plan';
    // Multi-page PDF under one sheet file: A101 · p2
    if (pageCount > 1 && pageNum) {
      const sheet =
        (drawingMeta && drawingMeta.sheet_id) || parseSheetFromFilename(fileName).sheetId;
      if (sheet) return pageNum === 1 ? base : `${sheet} · p${pageNum}`;
      return `${base} · p${pageNum}`;
    }
    return base;
  }

  /** Prefer floor-plan-like files first when server didn't sort them. */
  function orderDrawingsForTakeoff(drawings) {
    const list = (drawings || []).map((d) => {
      if (d.plan_score != null) return d;
      const parsed = parseSheetFromFilename(d.name || '');
      const name = (d.name || '').toLowerCase();
      let score = 0;
      let role = 'drawing';
      if (/addendum|rules|regs|spec\b|general notes|cover sheet|drawing index|requirements|vendor|hours of operation/i.test(name)) {
        score -= 40;
        role = 'document';
      }
      if (/floor plan|finish plan|rcp|power plan|elevation|demo|new work|shell|plan\b|a\d{2,3}/i.test(name)) {
        score += 35;
        role = 'plan';
      }
      if (parsed.sheetId) {
        score += 25;
        if (/^[ASMEPGL]/i.test(parsed.sheetId)) {
          score += 20;
          role = 'plan';
        }
      }
      if ((d.size || 0) > 500000) score += 5;
      return {
        ...d,
        sheet_id: d.sheet_id || parsed.sheetId,
        page_label: d.page_label || parsed.pageLabel,
        plan_score: score,
        role,
        is_plan_likely: score >= 10 && role !== 'document',
      };
    });
    list.sort((a, b) => {
      const ds = (b.plan_score || 0) - (a.plan_score || 0);
      if (ds) return ds;
      return String(a.sheet_id || a.name || '').localeCompare(String(b.sheet_id || b.name || ''), undefined, {
        numeric: true,
      });
    });
    return list;
  }

  function openModal(id) {
    $(`#${id}`)?.classList.add('open');
  }
  function closeModal(id) {
    // Closing condition editor without Save must undo live color preview
    if (id === 'modalCondition' && _condEditSnapshot && editingConditionId) {
      const p = project();
      const snap = _condEditSnapshot;
      const c = p?.conditions.find((x) => x.id === snap.id);
      if (c && c.color !== snap.color) {
        c.color = snap.color;
        planCanvas?.draw();
        const row = $(`#conditionsList .cond-row[data-cond-id="${c.id}"] .cond-swatch`);
        if (row) row.style.background = c.color;
      }
      _condEditSnapshot = null;
      editingConditionId = null;
    }
    $(`#${id}`)?.classList.remove('open');
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }

  // ---------- tabs ----------
  function applyTabVisibility() {
    const hasBid = !!project();
    const opt = state.visibleOptionalTabs || {};

    $$('.tab').forEach((tab) => {
      const name = tab.dataset.tab;
      const isOptional = tab.classList.contains('optional');
      // Bid required for takeoff workspaces
      const bidRequired = !['projects', 'resources', 'library', 'folders'].includes(name);

      if (isOptional) {
        // default false for optional tabs unless explicitly enabled
        const show = opt[name] === true;
        tab.classList.toggle('hidden-tab', !show);
      }

      if (bidRequired) {
        tab.classList.toggle('locked', !hasBid);
      } else {
        tab.classList.remove('locked');
      }
    });

    const active = $('.tab.active');
    if (active && (active.classList.contains('locked') || active.classList.contains('hidden-tab'))) {
      switchTab(hasBid ? 'takeoff' : 'library');
    }
  }

  function switchTab(name, force = false) {
    const tab = $(`.tab[data-tab="${name}"]`);
    if (!tab) return;
    if (!force && (tab.classList.contains('locked') || tab.classList.contains('hidden-tab'))) return;
    // When forcing (e.g. Open Job), unlock bid tabs first
    if (force && tab.classList.contains('locked')) {
      tab.classList.remove('locked');
    }

    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
    state.lastTab = name;
    save();

    if (name === 'takeoff') {
      requestAnimationFrame(() => {
        planCanvas?.resize();
        refreshTakeoff();
      });
    }
    if (name === 'summary') renderSummary();
    if (name === 'estimate') renderEstimate();
    if (name === 'scope') refreshScopePanel();
    if (name === 'cover') renderCover();
    if (name === 'worksheet') renderWorksheet();
    if (name === 'budget') renderBudget();
    if (name === 'notes') renderNotes();
    if (name === 'library') refreshLibraryUi();
    if (name === 'folders') refreshFoldersUi();
  }

  // ---------- Estimates library ----------
  let libraryProjects = [];

  async function refreshLibraryUi() {
    const status = $('#libraryStatus');
    const rootLabel = $('#libraryRootLabel');
    const E = window.PTEstimates;
    if (!E) return;

    const online = await E.init();
    if (!online) {
      status.textContent = 'Server offline — run Launch PlanTakeoff.bat';
      status.className = 'chip bad';
      rootLabel.textContent = 'Bids root: —';
      $('#libraryGrid').innerHTML =
        '<div class="empty-state"><h2>Local server required</h2><p>Double-click <strong>Launch PlanTakeoff.bat</strong> so PlanTakeoff can read your Estimates folders.</p></div>';
      return;
    }
    status.textContent = 'Server online';
    status.className = 'chip ok';
    rootLabel.textContent = `Bids root: ${E.config.bids_root}`;

    const yearSel = $('#libraryYear');
    const years = E.config.year_folders || [];
    const prev = yearSel.value;
    yearSel.innerHTML = `<option value="">All years</option>` + years.map((y) => {
      const m = y.match(/(\d{4})/);
      const val = m ? m[1] : y;
      return `<option value="${escAttr(val)}">${esc(y)}</option>`;
    }).join('');
    if (prev) yearSel.value = prev;

    await scanLibrary();
  }

  async function scanLibrary() {
    const E = window.PTEstimates;
    if (!E?.online) return refreshLibraryUi();
    try {
      $('#libraryStatus').textContent = 'Scanning…';
      const year = $('#libraryYear')?.value || '';
      const data = await E.scan(year || undefined);
      libraryProjects = data.projects || [];
      $('#libraryStatus').textContent = `${data.count} jobs`;
      $('#libraryStatus').className = 'chip ok';
      renderLibraryFiltered();
    } catch (err) {
      $('#libraryStatus').textContent = err.message;
      $('#libraryStatus').className = 'chip bad';
    }
  }

  function renderLibraryFiltered() {
    const filter = ($('#libraryFilter')?.value || '').toLowerCase().trim();
    const list = libraryProjects.filter((p) => {
      if (!filter) return true;
      const blob = `${p.bid_ref} ${p.project_name} ${p.folder_name}`.toLowerCase();
      return blob.includes(filter);
    });
    window.PTEstimates.renderLibrary($('#libraryGrid'), list, {
      onOpenBid: openBidFromEstimate,
      onExplorer: async (proj) => {
        try {
          await window.PTEstimates.openFolder(proj.folder_path);
        } catch (e) {
          alert(e.message);
        }
      },
    });
  }

  function showProjectFiles(proj) {
    $('#modalFilesTitle').textContent = `${proj.bid_ref} — ${proj.project_name}`;
    const drawings = (proj.drawings || [])
      .map(
        (f) =>
          `<li><a href="${window.PTEstimates.fileUrl(f.path)}" target="_blank" rel="noopener">${esc(f.rel || f.name)}</a>
           <button type="button" class="btn-sm" data-load-plan="${escAttr(f.path)}" data-name="${escAttr(f.name)}">Load to Takeoff</button></li>`
      )
      .join('');
    const estimates = (proj.estimates || [])
      .map((f) => `<li><a href="${window.PTEstimates.fileUrl(f.path)}" target="_blank" rel="noopener">${esc(f.rel || f.name)}</a></li>`)
      .join('');
    $('#modalFilesBody').innerHTML = `
      <p style="color:var(--text-dim);margin:0 0 8px">${esc(proj.folder_path)}</p>
      <h4 style="margin:8px 0 4px">Drawings (${proj.drawing_count || 0})</h4>
      <ul style="margin:0;padding-left:18px;line-height:1.7">${drawings || '<li>None found in 01 Drawings</li>'}</ul>
      <h4 style="margin:12px 0 4px">Estimates (${proj.estimate_count || 0})</h4>
      <ul style="margin:0;padding-left:18px;line-height:1.7">${estimates || '<li>None found in 02 Estimates</li>'}</ul>
      <p style="margin-top:12px;color:var(--text-dim)">PNG/JPG load directly. PDF plans are rendered in-browser (pick a page if multi-sheet).</p>
    `;
    openModal('modalFiles');
    $$('#modalFilesBody [data-load-plan]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const path = btn.getAttribute('data-load-plan');
        const name = btn.getAttribute('data-name') || 'plan';
        await loadPlanFromServerPath(path, name);
        closeModal('modalFiles');
      });
    });
  }

  async function applyRenderedPlan(dataUrl, width, height, pageName, extra = {}) {
    const p = project();
    const page = activePage();
    if (!p || !page) return;
    // Compress PNG → JPEG so storage stays lean (IndexedDB still holds it)
    // IMPORTANT: if image is downscaled, feetPerPixel / dpi must use effective DPI
    $('#statusDim').textContent = 'Optimizing plan image…';
    const packed = await packPlanImage(dataUrl, width || 0, height || 0);
    const w = packed.w;
    const h = packed.h;
    const stored = packed.dataUrl;
    const prevName = page.name || '';
    const wasBlankPage =
      !page.imageDataUrl ||
      !prevName ||
      /^page\s*\d+$/i.test(prevName) ||
      /^sheet\s*\d+$/i.test(prevName);
    page.imageDataUrl = stored;
    page.hasImage = true;
    page.imageWidth = w;
    page.imageHeight = h;
    // Auto-name from plan file (always when forceName, or when page still has a generic title)
    if (pageName && (extra.forceName || wasBlankPage)) {
      page.name = ''; // exclude self from uniqueness
      page.name = nextPageName(p, pageName);
    }
    const renderDpi = extra.dpi || 180;
    // Effective DPI after pack downscale (pixelScale = origW/storedW ≥ 1)
    page.renderDpi = renderDpi;
    page.pixelScale = packed.pixelScale || 1;
    page.dpi = effectiveDpi(renderDpi, packed.pixelScale);
    if (extra.pdfPage != null) page.pdfPage = extra.pdfPage;
    if (extra.sourcePath) page.sourcePath = extra.sourcePath;
    if (!page.calibrated) {
      page.feetPerPixel = M.feetPerPixelFromScale(page.scaleId || '1/4', page.dpi);
    }
    Store.touchProject(p);
    await save(true);
    switchTab('takeoff');
    await syncCanvasImage();
    planCanvas?.fitToView();
    planCanvas?.draw();
    renderPagesList();
    updateScaleBadge();
    $('#statusDim').textContent = 'Plan loaded';
  }

  async function loadPlanFromServerPath(filePath, name) {
    const p = project();
    if (!p) {
      alert('Open or create a takeoff bid first (or use Open Bid from the library).');
      return;
    }
    const ext = (name || filePath).toLowerCase();
    try {
      $('#statusDim').textContent = 'Loading plan…';
      const res = await fetch(window.PTEstimates.fileUrl(filePath));
      if (!res.ok) throw new Error('Could not load file');
      const blob = await res.blob();

      if (ext.endsWith('.pdf') || blob.type === 'application/pdf') {
        if (!window.PTPdf) throw new Error('PDF loader missing — refresh the page');
        const result = await window.PTPdf.fromFile(blob);
        if (!result) return; // cancelled
        const base = name.replace(/\.pdf$/i, '');
        await applyRenderedPlan(
          result.dataUrl,
          result.width,
          result.height,
          `${base} p${result.pageNumber}`,
          { dpi: 180, pdfPage: result.pageNumber, sourcePath: filePath }
        );
        $('#statusDim').textContent = `PDF page ${result.pageNumber}/${result.pageCount} loaded`;
        return;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const img = await loadImageEl(dataUrl);
      await applyRenderedPlan(dataUrl, img.width, img.height, name.replace(/\.[^.]+$/, ''), {
        sourcePath: filePath,
      });
      $('#statusDim').textContent = 'Plan loaded';
    } catch (e) {
      alert('Load failed: ' + e.message);
    }
  }

  function sheetKey(sourcePath, pdfPage) {
    const p = String(sourcePath || '').toLowerCase();
    if (pdfPage != null && pdfPage !== '') return `${p}::p${pdfPage}`;
    return p;
  }

  function pageHasPlan(page) {
    return !!(page && page.imageDataUrl && String(page.imageDataUrl).length > 64);
  }

  /** Sheet keys already imported: "path::p1", "path::p2" (never mark whole PDF from one page). */
  function importedSheetKeys(project) {
    const keys = new Set();
    for (const pg of project.pages || []) {
      if (!pg.sourcePath) continue;
      if (!(pageHasPlan(pg) || pg.hasImage)) continue;
      const pdfPage = pg.pdfPage != null ? pg.pdfPage : 1;
      keys.add(sheetKey(pg.sourcePath, pdfPage));
    }
    return keys;
  }

  /** Which PDF page numbers we already have for a file path. */
  function existingPdfPagesFor(project, sourcePath) {
    const set = new Set();
    const pk = String(sourcePath || '').toLowerCase();
    for (const pg of project.pages || []) {
      if (String(pg.sourcePath || '').toLowerCase() !== pk) continue;
      if (!(pageHasPlan(pg) || pg.hasImage)) continue;
      set.add(pg.pdfPage != null ? pg.pdfPage : 1);
    }
    return set;
  }

  let _openJobBusy = false;
  let _openJobBusySince = 0;
  let _bgImportToken = 0;

  function paintingStarterConditions(layers) {
    return [
      // Walls = linear LF (height → wall SF as secondary)
      M.createCondition('linear', {
        number: 1,
        name: 'PT-1 Walls',
        type: 'Finishes',
        layerId: layers[0]?.id,
        color: '#e74c3c',
        height: 8,
        unitPrimary: 'LF',
        unitSecondary: 'SF',
        materialUnitCost: 0.35,
        laborUnitCost: 0.9,
      }),
      M.createCondition('area', {
        number: 2,
        name: 'Ceilings',
        type: 'Finishes',
        layerId: layers[0]?.id,
        color: '#3498db',
        unitPrimary: 'SF',
        materialUnitCost: 0.3,
        laborUnitCost: 0.75,
      }),
      M.createCondition('count', {
        number: 3,
        name: 'Doors',
        type: 'Doors & Windows',
        layerId: layers[1]?.id,
        color: '#f39c12',
        unitPrimary: 'EA',
        materialUnitCost: 8,
        laborUnitCost: 35,
      }),
      M.createCondition('linear', {
        number: 4,
        name: 'Base / Trim',
        type: 'Finishes',
        layerId: layers[0]?.id,
        color: '#9b59b6',
        height: 0.33,
        unitPrimary: 'LF',
        unitSecondary: 'SF',
        materialUnitCost: 0.15,
        laborUnitCost: 1.25,
      }),
    ];
  }

  function findJobProject(folderPath, bidRef) {
    return state.projects.find(
      (x) =>
        (folderPath && x.folderPath === folderPath) ||
        (bidRef && x.jobNumber === bidRef)
    );
  }

  async function showJobOnCanvas(p, folderName) {
    state.activeProjectId = p.id;
    selectedProjectId = p.id;
    const withPlan = p.pages.find((pg) => pageHasPlan(pg)) || p.pages[0];
    if (withPlan) p.activePageId = withPlan.id;
    Store.touchProject(p);
    renderProjects();
    updateHeader();
    applyTabVisibility();
    // force=true so Takeoff is never blocked by locked tab state
    switchTab('takeoff', true);
    try {
      await refreshTakeoff();
    } catch (e) {
      console.warn('refreshTakeoff', e);
    }
    try {
      await syncCanvasImage();
    } catch (e) {
      console.warn('syncCanvasImage', e);
    }
    // Fix wrong LF on pages imported before pack/downscale compensation
    try {
      const page = activePage();
      if (page && !page.calibrated) {
        const fixed = await tryRepairPageScaleFromSource(page);
        if (fixed) {
          Store.touchProject(p);
          await save(true);
          renderConditionsList();
          updateScaleBadge();
          planCanvas?.draw();
          $('#statusDim').textContent = `${folderName} · scale auto-corrected for image resize · verify with From mark…`;
        }
      }
    } catch (e) {
      console.warn('scale repair', e);
    }
    planCanvas?.fitToView();
    planCanvas?.draw();
    const n = p.pages.filter((pg) => pageHasPlan(pg)).length;
    const page = activePage();
    if (!(page && !page.calibrated && page.scaleSource === 'repaired-pixelScale')) {
      $('#statusDim').textContent = `${folderName} · ${n} sheet(s) · ready to digitize`;
    }
  }

  /**
   * Open job from library row click.
   * Resilient: never leave _openJobBusy stuck; reopen works offline from IDB.
   */
  async function openBidFromEstimate(proj) {
    if (!proj) {
      $('#statusDim').textContent = 'No job data — Scan Jobs first';
      return;
    }
    if (_openJobBusy) {
      // Allow retry if previous open hung > 2 min
      if (!_openJobBusySince || Date.now() - _openJobBusySince < 120000) {
        $('#statusDim').textContent = 'Still opening a job — wait or restart app';
        return;
      }
    }
    _openJobBusy = true;
    _openJobBusySince = Date.now();
    const token = ++_bgImportToken;
    const folderPath = proj.folder_path || '';
    const bidRef = proj.bid_ref || '';
    const folderName = proj.folder_name || proj.project_name || bidRef || 'Job';

    try {
      $('#statusDim').textContent = `Opening ${folderName}…`;
      const E = window.PTEstimates;

      let online = false;
      try {
        online = !!(await E.init());
      } catch (e) {
        console.warn('init', e);
      }

      let p = findJobProject(folderPath, bidRef);

      // ── FAST REOPEN: have pages (restore images from IDB) ───────────
      if (p && (p.pages || []).length) {
        try {
          if (Store.hydrateProjectImages) await Store.hydrateProjectImages(p);
        } catch (e) {
          console.warn('hydrate', e);
        }
        p.name = folderName;
        p.jobNumber = bidRef || p.jobNumber;
        p.folderPath = folderPath || p.folderPath;
        await showJobOnCanvas(p, folderName);
        if (online) queueBackgroundImport(p, folderPath, folderName, token, proj);
        return;
      }

      // ── FIRST OPEN needs server to read 01 Drawings ────────────────
      if (!online) {
        alert(
          'Cannot load drawings — local server is offline.\n\n' +
            'Use PlanTakeoff.exe (desktop app), not a browser file open.\n' +
            'Then Scan Jobs and click the job again.'
        );
        $('#statusDim').textContent = 'Server offline';
        return;
      }

      let drawings = proj.plan_drawings || proj.drawings || [];
      if (!drawings.length && E.getProject && folderPath) {
        try {
          const full = await E.getProject(folderPath);
          const plans = full.plan_drawings || [];
          const others = full.other_drawings || [];
          drawings = plans.length ? [...plans, ...others] : full.drawings || [];
          if (full.folder_name) {
            proj = { ...proj, ...full };
          }
        } catch (e) {
          console.warn('getProject', e);
          $('#statusDim').textContent = 'Could not read job folder: ' + (e.message || e);
        }
      }
      drawings = orderDrawingsForTakeoff(drawings || []);

      if (!p) {
        p = M.createProject({
          name: folderName,
          jobNumber: bidRef,
          status: 'Bidding',
          estimator: 'WL Painting Inc.',
          description: `Job folder: ${folderPath}`,
          folderPath,
          drawingsFolder: folderPath + '\\01 Drawings',
          estimatesFolder: folderPath + '\\02 Estimates',
        });
        p.cover.company = 'WL Painting Inc.';
        p.conditions = paintingStarterConditions(p.layers);
        p.activeConditionId = p.conditions[0].id;
        p.pages = [];
        state.projects.unshift(p);
      } else {
        p.name = folderName;
        p.folderPath = folderPath || p.folderPath;
        try {
          if (Store.hydrateProjectImages) await Store.hydrateProjectImages(p);
        } catch (_) {
          /* ignore */
        }
      }

      state.activeProjectId = p.id;
      selectedProjectId = p.id;
      applyTabVisibility();

      if (!drawings.length) {
        await showJobOnCanvas(p, folderName);
        alert(
          `No drawings found in:\n${folderPath}\\01 Drawings\n\n` +
            'Put PDF/PNG plans there and open the job again.'
        );
        return;
      }

      try {
        await loadDrawingsAsTakeoffPages(p, drawings, {
          maxFiles: 1,
          pdfScale: 1.75,
          maxPdfPages: 40,
        });
      } catch (e) {
        console.error(e);
        alert('Drawing import error:\n' + (e.message || e));
      }

      try {
        await save(true);
      } catch (e) {
        console.warn('save after import', e);
      }

      await showJobOnCanvas(p, folderName);
      const n0 = p.pages.filter(pageHasPlan).length;
      $('#statusDim').textContent =
        n0 > 0
          ? `${folderName}: ${n0} sheet(s) · loading more…`
          : `${folderName}: opened — drawings failed to render`;

      queueBackgroundImport(p, folderPath, folderName, token, {
        ...proj,
        drawings,
      });
    } catch (e) {
      console.error('openBidFromEstimate', e);
      alert('Could not open job:\n' + (e && e.message ? e.message : e));
      $('#statusDim').textContent = 'Open job failed';
    } finally {
      _openJobBusy = false;
      _openJobBusySince = 0;
    }
  }

  function queueBackgroundImport(p, folderPath, folderName, token, projHint) {
    (async () => {
      try {
        const E = window.PTEstimates;
        let drawings =
          projHint?.plan_drawings ||
          projHint?.drawings ||
          [];
        if (!drawings.length && folderPath) {
          try {
            const full = await E.getProject(folderPath);
            const plans = full.plan_drawings || [];
            const others = full.other_drawings || [];
            drawings = plans.length ? [...plans, ...others] : full.drawings || [];
          } catch {
            return;
          }
        }
        drawings = orderDrawingsForTakeoff(drawings);
        if (token !== _bgImportToken) return;
        if (state.activeProjectId !== p.id) return;

        // Multiple passes: fill remaining PDF pages + other files
        let totalAdded = 0;
        for (let pass = 0; pass < 8; pass++) {
          if (token !== _bgImportToken || state.activeProjectId !== p.id) return;
          const result = await loadDrawingsAsTakeoffPages(p, drawings, {
            maxFiles: 12,
            pdfScale: 1.85,
            maxPdfPages: 40,
          });
          totalAdded += result.added;
          if (result.added === 0) break;
          Store.touchProject(p);
          await save(true);
          renderPagesList();
          $('#statusDim').textContent = `${folderName}: ${p.pages.filter(pageHasPlan).length} sheet(s) loading…`;
        }
        if (token !== _bgImportToken || state.activeProjectId !== p.id) return;
        const n = p.pages.filter(pageHasPlan).length;
        $('#statusDim').textContent =
          totalAdded > 0
            ? `${folderName}: ${n} sheet(s) ready (+${totalAdded})`
            : `${folderName}: ${n} sheet(s) · ready`;
        renderPagesList();
      } catch (e) {
        console.warn('Background import', e);
      }
    })();
  }

  /**
   * Import drawings.
   * - PDF: each PDF page = one takeoff page; missing page numbers are filled in later
   * - Image: one page; skipped if already present
   * opts.maxFiles — max drawing *files* to open this call (files that still need pages)
   * opts.maxPdfPages — max pages to pull from each PDF this call
   */
  async function loadDrawingsAsTakeoffPages(project, drawings, opts = {}) {
    const out = { added: 0, skipped: 0, failed: 0 };
    if (!drawings?.length) return out;

    const E = window.PTEstimates;
    if (!E?.fileUrl) throw new Error('Server offline');

    if (window.PTPdf?.ensurePdfJs) {
      try {
        await window.PTPdf.ensurePdfJs();
      } catch (e) {
        console.warn('PDF.js', e);
      }
    }

    const already = importedSheetKeys(project);
    let pageNum = project.pages.length;
    const maxFiles = opts.maxFiles ?? 40;
    const maxPdfPages = opts.maxPdfPages ?? 40;
    const pdfScale = opts.pdfScale ?? 1.85;
    let filesTouched = 0;

    for (const d of drawings) {
      if (filesTouched >= maxFiles) break;
      const path = d.path;
      if (!path) continue;
      const pathKey = path.toLowerCase();
      const nameLower = (d.name || path).toLowerCase();
      const looksPdf = nameLower.endsWith('.pdf');
      const havePages = existingPdfPagesFor(project, path);

      // Image already imported once
      if (!looksPdf && havePages.size > 0) {
        out.skipped += 1;
        continue;
      }

      let res;
      try {
        res = await fetch(E.fileUrl(path));
      } catch {
        out.failed += 1;
        continue;
      }
      if (!res.ok) {
        out.failed += 1;
        continue;
      }
      const blob = await res.blob();
      const isPdf = looksPdf || blob.type === 'application/pdf';

      try {
        if (isPdf) {
          if (!window.PTPdf) throw new Error('PDF loader missing');
          const buf = await blob.arrayBuffer();
          const pdf = await window.PTPdf.openPdf(buf);
          const total = pdf.numPages || 1;
          const n = Math.min(total, maxPdfPages);
          let fileAdded = false;
          for (let i = 1; i <= n; i++) {
            const sk = sheetKey(path, i);
            if (already.has(sk) || havePages.has(i)) {
              out.skipped += 1;
              continue;
            }
            $('#statusDim').textContent = `Importing ${d.name || 'drawing'} · p${i}/${total}…`;
            const rendered = await window.PTPdf.renderPageToDataUrl(pdf, i, pdfScale);
            const packed = await packPlanImage(rendered.dataUrl, rendered.width, rendered.height);
            pageNum += 1;
            const label = nameFromPlanFile(d.name || 'Drawing', i, total, d);
            const renderDpi = Math.round(72 * pdfScale);
            const dpi = effectiveDpi(renderDpi, packed.pixelScale);
            const page = M.createPage({
              name: nextPageName(project, label),
              pageNumber: pageNum,
              scaleId: '1/4',
              dpi,
              feetPerPixel: M.feetPerPixelFromScale('1/4', dpi),
              imageDataUrl: packed.dataUrl,
              imageWidth: packed.w,
              imageHeight: packed.h,
            });
            page.hasImage = true;
            page.renderDpi = renderDpi;
            page.pixelScale = packed.pixelScale || 1;
            page.sourcePath = path;
            page.pdfPage = i;
            page.pdfPageCount = total;
            page.drawingName = d.name;
            page.sheetId = d.sheet_id || parseSheetFromFilename(d.name || '').sheetId;
            page.sheetTitle = d.sheet_title || '';
            project.pages.push(page);
            already.add(sk);
            havePages.add(i);
            out.added += 1;
            fileAdded = true;
          }
          // More pages left in this PDF? Background will continue (filesTouched still counts)
          if (fileAdded || havePages.size < total) filesTouched += 1;
          else out.skipped += 1;
        } else {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const packed = await packPlanImage(dataUrl, 0, 0);
          pageNum += 1;
          const label = nameFromPlanFile(d.name || 'Drawing', 1, 1, d);
          const renderDpi = 96;
          const dpi = effectiveDpi(renderDpi, packed.pixelScale);
          const page = M.createPage({
            name: nextPageName(project, label),
            pageNumber: pageNum,
            scaleId: '1/4',
            dpi,
            feetPerPixel: M.feetPerPixelFromScale('1/4', dpi),
            imageDataUrl: packed.dataUrl,
            imageWidth: packed.w,
            imageHeight: packed.h,
          });
          page.hasImage = true;
          page.renderDpi = renderDpi;
          page.pixelScale = packed.pixelScale || 1;
          page.sourcePath = path;
          page.pdfPage = 1;
          page.drawingName = d.name;
          page.sheetId = d.sheet_id || parseSheetFromFilename(d.name || '').sheetId;
          page.sheetTitle = d.sheet_title || '';
          project.pages.push(page);
          already.add(sheetKey(path, 1));
          out.added += 1;
          filesTouched += 1;
        }
      } catch (e) {
        console.error('Import drawing failed', path, e);
        out.failed += 1;
      }
    }
    return out;
  }

  /**
   * Measure natural size of a data-URL image.
   */
  function measureImageDataUrl(dataUrl, fallbackW = 0, fallbackH = 0) {
    return new Promise((resolve) => {
      if (!dataUrl) {
        resolve({ w: fallbackW, h: fallbackH });
        return;
      }
      const im = new Image();
      im.onload = () =>
        resolve({
          w: im.naturalWidth || fallbackW || 0,
          h: im.naturalHeight || fallbackH || 0,
        });
      im.onerror = () => resolve({ w: fallbackW || 0, h: fallbackH || 0 });
      im.src = dataUrl;
    });
  }

  /**
   * Effective image DPI after pack/downscale.
   * pixelScale = origPixels / storedPixels (≥ 1 when downscaled).
   * feetPerPixel = feetPerInch / effectiveDpi — must rise when image shrinks.
   */
  function effectiveDpi(renderDpi, pixelScale) {
    const rd = Number(renderDpi) || 96;
    const ps = Number(pixelScale) > 0 ? Number(pixelScale) : 1;
    return rd / ps;
  }

  /**
   * Compress plan image for storage.
   * Returns pixelScale so scale math stays correct after max-edge downscale.
   * (Bug: previously fpp used full-res DPI on a shrunk image → LF too short, e.g. 6.42 vs 8'-0".)
   */
  async function packPlanImage(dataUrl, w, h) {
    let origW = w || 0;
    let origH = h || 0;
    if (!origW || !origH) {
      const m0 = await measureImageDataUrl(dataUrl, origW, origH);
      origW = m0.w || origW;
      origH = m0.h || origH;
    }
    let out = dataUrl;
    try {
      if (Store.compressPlanDataUrl) {
        // maxEdge 3600 keeps IDB lean; pixelScale compensates scale
        out = await Store.compressPlanDataUrl(dataUrl, 0.82, 3600);
      }
    } catch {
      out = dataUrl;
    }
    const dims = await measureImageDataUrl(out, origW, origH);
    let pixelScale = 1;
    if (origW > 0 && dims.w > 0) {
      pixelScale = origW / dims.w;
    } else if (origH > 0 && dims.h > 0) {
      pixelScale = origH / dims.h;
    }
    // Guard against noise / upscale
    if (!Number.isFinite(pixelScale) || pixelScale < 0.99) pixelScale = 1;
    if (pixelScale > 1.001) {
      // Keep modest precision
      pixelScale = Math.round(pixelScale * 1e6) / 1e6;
    } else {
      pixelScale = 1;
    }
    return {
      dataUrl: out,
      w: dims.w,
      h: dims.h,
      origW,
      origH,
      pixelScale,
    };
  }

  /**
   * Fix scale on pages imported before pixelScale compensation.
   * Uses stored renderDpi + current image size when we know the render was larger.
   */
  function repairPageScaleIfNeeded(page) {
    if (!page || page.calibrated) return false;
    let changed = false;
    if (page.pixelScale > 1.001 && page.renderDpi) {
      const dpi = effectiveDpi(page.renderDpi, page.pixelScale);
      if (Math.abs((page.dpi || 0) - dpi) > 0.5) {
        page.dpi = dpi;
        changed = true;
      }
      const fpp = M.feetPerPixelFromScale(page.scaleId || '1/4', dpi);
      if (fpp && Math.abs((page.feetPerPixel || 0) - fpp) / fpp > 0.01) {
        page.feetPerPixel = fpp;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Existing jobs: re-render source PDF once to discover pack downscale ratio,
   * then correct feetPerPixel without replacing the stored image (geometry stays valid).
   */
  async function tryRepairPageScaleFromSource(page) {
    if (!page || page.calibrated || page._scaleRepairTried) return false;
    if (repairPageScaleIfNeeded(page)) {
      page._scaleRepairTried = true;
      return true;
    }
    if (!page.sourcePath || !window.PTPdf || !window.PTEstimates?.fileUrl) {
      page._scaleRepairTried = true;
      return false;
    }
    // Only worth it when image looks max-edge clamped or dpi looks like unadjusted render DPI
    const maxDim = Math.max(page.imageWidth || 0, page.imageHeight || 0);
    const looksClamped = maxDim >= 3500 && maxDim <= 3608;
    if (!looksClamped && page.pixelScale) {
      page._scaleRepairTried = true;
      return false;
    }
    page._scaleRepairTried = true;
    try {
      const E = window.PTEstimates;
      const res = await fetch(E.fileUrl(page.sourcePath));
      if (!res.ok) return false;
      const buf = await res.arrayBuffer();
      await window.PTPdf.ensurePdfJs?.();
      const pdf = await window.PTPdf.openPdf(buf);
      const pdfPage = page.pdfPage || 1;
      // Match common import scales (first open 1.75, background 1.85, manual 2–2.5)
      const scales = [1.85, 1.75, 2.0, 1.5, 2.5, 1.6];
      for (const pdfScale of scales) {
        const rendered = await window.PTPdf.renderPageToDataUrl(pdf, pdfPage, pdfScale);
        const packed = await packPlanImage(rendered.dataUrl, rendered.width, rendered.height);
        const dw = Math.abs((packed.w || 0) - (page.imageWidth || 0));
        const dh = Math.abs((packed.h || 0) - (page.imageHeight || 0));
        if (dw <= 6 && dh <= 6 && packed.pixelScale > 1.001) {
          page.renderDpi = Math.round(72 * pdfScale);
          page.pixelScale = packed.pixelScale;
          page.dpi = effectiveDpi(page.renderDpi, page.pixelScale);
          page.feetPerPixel = M.feetPerPixelFromScale(page.scaleId || '1/4', page.dpi);
          page.scaleSource = 'repaired-pixelScale';
          return true;
        }
        // Exact match without downscale — preset dpi was already correct
        if (dw <= 6 && dh <= 6 && packed.pixelScale <= 1.001) {
          page.renderDpi = Math.round(72 * pdfScale);
          page.pixelScale = 1;
          page.dpi = page.renderDpi;
          page.feetPerPixel = M.feetPerPixelFromScale(page.scaleId || '1/4', page.dpi);
          return false; // no material change expected
        }
      }
    } catch (e) {
      console.warn('Scale repair from source failed', e);
    }
    return false;
  }

  // ---------- New folders (FOLDERS.bat) ----------
  async function refreshFoldersUi() {
    const E = window.PTEstimates;
    const online = await E.init();
    if (!online) {
      $('#folderLog').textContent = 'Server offline. Run Launch PlanTakeoff.bat first.';
      return;
    }
    if (!$('#folderYear').value) {
      $('#folderYear').value = E.config.default_year || new Date().getFullYear();
    }
    if (!$('#folderCode').value) {
      try {
        const s = await E.suggestCode(
          Number($('#folderYear').value),
          $('#folderMonth').value || undefined
        );
        $('#folderCode').value = s.code;
      } catch (_) {
        /* ignore */
      }
    }
  }

  async function createOneFolder() {
    const E = window.PTEstimates;
    if (!(await E.init())) {
      alert('Start Launch PlanTakeoff.bat first.');
      return;
    }
    try {
      const result = await E.createProject({
        year: Number($('#folderYear').value),
        month: $('#folderMonth').value.trim() || null,
        code: $('#folderCode').value.trim(),
        description: $('#folderDesc').value.trim(),
        takeoff: $('#folderTakeoff').checked,
      });
      $('#folderLog').textContent =
        `${result.created ? 'Created' : 'Already existed'}: ${result.folder_path}\n` +
        `Subfolders: ${(result.subfolders || []).join(', ')}`;
      // bump suggest for next
      const s = await E.suggestCode(
        Number($('#folderYear').value),
        $('#folderMonth').value || undefined
      );
      $('#folderCode').value = s.code;
      $('#folderDesc').value = '';
    } catch (e) {
      $('#folderLog').textContent = 'Error: ' + e.message;
    }
  }

  async function createBatchFolders() {
    const E = window.PTEstimates;
    if (!(await E.init())) {
      alert('Start Launch PlanTakeoff.bat first.');
      return;
    }
    const year = Number($('#folderYear').value);
    const month = $('#folderMonth').value.trim() || null;
    const takeoff = $('#folderTakeoff').checked;
    const lines = ($('#folderBatch').value || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      alert('Enter one project per line.');
      return;
    }

    let seq = null;
    const projects = [];
    for (const line of lines) {
      let code = '';
      let desc = line;
      if (line.includes('|')) {
        const parts = line.split('|');
        code = parts[0].trim();
        desc = parts.slice(1).join('|').trim();
      } else {
        const m = line.match(/^(EST\d+)\s*[-–|]\s*(.+)$/i);
        if (m) {
          code = m[1];
          desc = m[2];
        }
      }
      if (!code) {
        if (seq == null) {
          const s = await E.suggestCode(year, month || undefined);
          seq = s.code;
        } else {
          // increment last 3 digits
          const m = seq.match(/^(EST\d+)(\d{3})$/i);
          if (m) seq = m[1] + String(Number(m[2]) + 1).padStart(3, '0');
          else seq = seq + 'x';
        }
        code = seq;
        // advance for next
        const m2 = seq.match(/^(EST\d+)(\d{3})$/i);
        if (m2) seq = m2[1] + String(Number(m2[2]) + 1).padStart(3, '0');
      }
      projects.push({ code, description: desc });
    }

    try {
      const data = await E.createBatch({ year, month, takeoff, projects });
      const log = (data.results || [])
        .map((r) =>
          r.ok
            ? `✓ ${r.folder_name}\n  ${r.folder_path}`
            : `✗ ${r.code || ''} ${r.error || ''}`
        )
        .join('\n');
      $('#folderLog').textContent = log || 'Done.';
      $('#folderBatch').value = '';
      const s = await E.suggestCode(year, month || undefined);
      $('#folderCode').value = s.code;
    } catch (e) {
      $('#folderLog').textContent = 'Error: ' + e.message;
    }
  }

  // ---------- projects ----------
  function renderProjects() {
    const tbody = $('#projectsTable tbody');
    const filter = ($('#projectFilter')?.value || '').toLowerCase().trim();
    const rows = state.projects.filter((p) => {
      if (!filter) return true;
      const blob = [p.name, p.jobNumber, p.client, p.location, p.status, p.estimator].join(' ').toLowerCase();
      return blob.includes(filter);
    });

    tbody.innerHTML = '';
    $('#projectsEmpty').hidden = rows.length > 0;

    for (const p of rows) {
      const tr = document.createElement('tr');
      if (p.id === selectedProjectId) tr.classList.add('selected');
      tr.innerHTML = `
        <td>${esc(p.jobNumber)}</td>
        <td><strong>${esc(p.name)}</strong></td>
        <td>${esc(p.client)}</td>
        <td>${esc(p.location)}</td>
        <td><span class="badge">${esc(p.status)}</span></td>
        <td>${esc(p.estimator)}</td>
        <td>${esc(p.bidDate)}</td>
        <td>${esc((p.updatedAt || '').slice(0, 10))}</td>
      `;
      tr.addEventListener('click', () => {
        selectedProjectId = p.id;
        state.activeProjectId = p.id;
        save();
        renderProjects();
        updateHeader();
        applyTabVisibility();
      });
      tr.addEventListener('dblclick', () => {
        selectedProjectId = p.id;
        state.activeProjectId = p.id;
        save();
        updateHeader();
        applyTabVisibility();
        switchTab('takeoff');
      });
      tbody.appendChild(tr);
    }
  }

  function updateHeader() {
    const p = project();
    const el = $('#headerMeta');
    if (!p) {
      el.innerHTML = 'No bid selected — open a project from the <strong>Projects</strong> tab';
      return;
    }
    el.innerHTML = `<strong>${esc(p.jobNumber || '—')}</strong>  ${esc(p.name)}  ·  ${esc(p.client || 'No client')}`;
  }

  function newProject() {
    const name = prompt('Bid name:', 'New Bid');
    if (!name) return;
    const p = M.createProject({ name });
    const page = M.createPage({ name: 'Page 1', feetPerPixel: M.feetPerPixelFromScale('1/4', 96) });
    p.pages = [page];
    p.activePageId = page.id;
    const cond = M.createCondition('linear', {
      number: 1,
      name: 'Wall',
      layerId: p.layers[0]?.id,
    });
    p.conditions = [cond];
    p.activeConditionId = cond.id;
    state.projects.unshift(p);
    state.activeProjectId = p.id;
    selectedProjectId = p.id;
    save();
    renderProjects();
    updateHeader();
    applyTabVisibility();
    switchTab('cover');
  }

  function duplicateProject() {
    const p = project();
    if (!p) return alert('Select a project first.');
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = M.uid();
    copy.name = `${p.name} (Copy)`;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    // re-id nested entities lightly keep structure
    state.projects.unshift(copy);
    state.activeProjectId = copy.id;
    selectedProjectId = copy.id;
    save();
    renderProjects();
    updateHeader();
  }

  function deleteProject() {
    const p = project();
    if (!p) return alert('Select a project first.');
    if (!confirm(`Delete bid "${p.name}"? This cannot be undone.`)) return;
    state.projects = state.projects.filter((x) => x.id !== p.id);
    state.activeProjectId = state.projects[0]?.id || null;
    selectedProjectId = state.activeProjectId;
    save();
    renderProjects();
    updateHeader();
    applyTabVisibility();
    switchTab('projects');
  }

  // ---------- cover ----------
  function renderCover() {
    const p = project();
    if (!p) return;
    const form = $('#coverForm');
    const fields = [
      ['name', 'Bid Name', p.name],
      ['jobNumber', 'Job Number', p.jobNumber],
      ['status', 'Status', p.status],
      ['client', 'Client', p.client],
      ['location', 'Location', p.location],
      ['estimator', 'Estimator', p.estimator],
      ['bidDate', 'Bid Date', p.bidDate, 'date'],
      ['dueDate', 'Due Date', p.dueDate, 'date'],
      ['architect', 'Architect', p.architect],
      ['cover.company', 'Company', p.cover.company],
      ['cover.contact', 'Contact', p.cover.contact],
      ['cover.phone', 'Phone', p.cover.phone],
      ['cover.email', 'Email', p.cover.email],
      ['cover.address', 'Address', p.cover.address],
      ['cover.city', 'City', p.cover.city],
      ['cover.state', 'State', p.cover.state],
      ['cover.zip', 'ZIP', p.cover.zip],
      ['cover.bidType', 'Bid Type', p.cover.bidType],
      ['cover.workflowStatus', 'Workflow Status', p.cover.workflowStatus],
      ['description', 'Description', p.description, 'textarea'],
      ['cover.notes', 'Cover Notes', p.cover.notes, 'textarea'],
    ];

    form.innerHTML = fields
      .map(([key, label, val, type]) => {
        const full = type === 'textarea' ? ' full' : '';
        if (type === 'textarea') {
          return `<div class="field${full}"><label>${label}</label><textarea data-cover="${key}">${esc(val || '')}</textarea></div>`;
        }
        const t = type === 'date' ? 'date' : 'text';
        return `<div class="field${full}"><label>${label}</label><input type="${t}" data-cover="${key}" value="${escAttr(val || '')}" /></div>`;
      })
      .join('');

    form.querySelectorAll('[data-cover]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.cover;
        const value = el.value;
        if (key.startsWith('cover.')) {
          p.cover[key.slice(6)] = value;
        } else {
          p[key] = value;
        }
        Store.touchProject(p);
        save();
        updateHeader();
        renderProjects();
      });
    });
  }

  // ---------- takeoff sidebar ----------
  /**
   * @param {{ fit?: boolean, rearm?: boolean }} [opts]
   * fit=false keeps zoom/pan (use after property edits)
   */
  async function refreshTakeoff(opts = {}) {
    const fit = opts.fit !== false;
    const rearm = opts.rearm !== false;
    renderConditionsList();
    renderLayersList();
    renderPagesList();
    fillScaleSelect();
    updateScaleBadge();
    await syncCanvasImage();
    if (rearm) {
      const c = activeCondition();
      if (c && planCanvas) {
        const t = planCanvas.tool;
        if (!t || t === 'select' || ['linear', 'area', 'count'].includes(t)) {
          armDigitize(c.id);
        } else {
          syncToolFromCondition();
        }
      } else {
        syncToolFromCondition();
      }
    }
    if (fit) planCanvas?.fitToView();
    planCanvas?.draw();
    updateDigitizeBar();
  }

  function renderConditionsList() {
    const p = project();
    const box = $('#conditionsList');
    if (!p) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '';
    if (!p.conditions.length) {
      box.innerHTML =
        '<div class="cond-empty">Add a condition (+L / +A / +C), then click the plan to digitize.</div>';
      updateDigitizeBar();
      return;
    }
    for (const c of p.conditions) {
      const q = M.aggregateConditionQuantities(p, c.id);
      const active = c.id === p.activeConditionId;
      const dig =
        active && planCanvas && ['linear', 'area', 'count'].includes(planCanvas.tool);
      const div = document.createElement('div');
      div.className =
        'cond-row list-item' + (active ? ' selected' : '') + (dig ? ' digitizing' : '');
      div.dataset.condId = c.id;
      div.setAttribute('data-cond-id', c.id);
      div.title = 'Click to digitize this condition (like PlanSwift). Double-click to edit.';
      const styleShort =
        c.style === 'linear' ? 'LIN' : c.style === 'area' ? 'AREA' : c.style === 'count' ? 'CNT' : c.style;
      div.innerHTML = `
        <span class="cond-swatch" style="background:${c.color}"></span>
        <div class="cond-main">
          <div class="cond-title">
            <span class="cond-num">${c.number}</span>
            <span class="cond-name">${esc(c.name)}</span>
            ${dig ? '<span class="cond-dig-tag">DIGITIZING</span>' : ''}
          </div>
          <div class="cond-sub">
            <span class="badge ${c.style}">${styleShort}</span>
            <span class="cond-type">${esc(c.type || '')}</span>
          </div>
        </div>
        <div class="cond-qty">
          <span class="cond-qty-val">${M.formatQty(q.primary)}</span>
          <span class="cond-qty-unit">${esc(defaultUnit(c.style))}</span>
          ${
            c.style === 'linear' && q.secondary > 0
              ? `<span class="cond-qty-n">${M.formatQty(q.secondary)} SF wall</span>`
              : c.style === 'area' && q.secondary > 0
                ? `<span class="cond-qty-n">${M.formatQty(q.secondary)} CF</span>`
                : ''
          }
          <span class="cond-qty-n">${q.count} obj</span>
        </div>
      `;
      div.addEventListener('click', () => armDigitize(c.id));
      div.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openConditionEditor(c.id);
      });
      box.appendChild(div);
    }
    updateDigitizeBar();
  }

  /** PlanSwift flow: pick condition → arm matching tool → ready to click plan. */
  function armDigitize(conditionId) {
    const p = project();
    if (!p) return;
    const c = p.conditions.find((x) => x.id === conditionId);
    if (!c) return;
    p.activeConditionId = c.id;
    save();
    const tool = c.style === 'area' ? 'area' : c.style === 'count' ? 'count' : 'linear';
    setTool(tool);
    renderConditionsList();
    planCanvas?.draw();
    updateDigitizeBar();
    $('#statusDim').textContent = `Digitizing: ${c.name} (${c.style})`;
  }

  function updateDigitizeBar() {
    const bar = $('#digitizeBar');
    if (!bar) return;
    const c = activeCondition();
    const dig =
      c && planCanvas && ['linear', 'area', 'count'].includes(planCanvas.tool);
    if (!dig || !c) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.style.borderLeftColor = c.color;
    const modeHint =
      c.style === 'linear'
        ? planCanvas.linearMode === 'segment'
          ? '2-click segs · Space/right-click finish · right-drag pans idle'
          : 'multi-point · Space/right-click/Enter finish'
        : c.style === 'area'
          ? 'corners · Space/right-click/Enter close · near-start closes'
          : 'each click = 1 · right-drag pans';
    $('#digitizeBarLabel').innerHTML = `
      <span class="dig-dot" style="background:${c.color}"></span>
      <strong>${esc(c.name)}</strong>
      <span class="dig-meta">${esc(c.style)} · #${c.number}</span>
      <span class="dig-hint">${modeHint}</span>
    `;
  }

  function renderLayersList() {
    const p = project();
    const box = $('#layersList');
    if (!p) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '';
    for (const layer of p.layers) {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `
        <input type="checkbox" ${layer.visible ? 'checked' : ''} />
        <span class="color-dot" style="background:${layer.color}"></span>
        <span class="name">${esc(layer.name)}</span>
      `;
      const cb = div.querySelector('input');
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        layer.visible = cb.checked;
        Store.touchProject(p);
        save();
        planCanvas?.draw();
      });
      div.addEventListener('dblclick', () => {
        const name = prompt('Layer name:', layer.name);
        if (name) {
          layer.name = name;
          Store.touchProject(p);
          save();
          renderLayersList();
        }
      });
      box.appendChild(div);
    }
  }

  function renderPagesList() {
    const p = project();
    const box = $('#pagesList');
    if (!p) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '';
    for (const page of p.pages) {
      const div = document.createElement('div');
      div.className = 'list-item' + (page.id === p.activePageId ? ' selected' : '');
      const scaleLabel = page.calibrated
        ? 'Calibrated'
        : M.PRESET_SCALES.find((s) => s.id === page.scaleId)?.label || page.scaleId;
      div.innerHTML = `
        <span class="name">${esc(page.name)}</span>
        <span class="meta">${page.imageDataUrl ? '●' : '○'} ${esc(scaleLabel)}</span>
      `;
      div.addEventListener('click', async () => {
        p.activePageId = page.id;
        save();
        renderPagesList();
        fillScaleSelect();
        updateScaleBadge();
        await syncCanvasImage();
        if (!page.calibrated) {
          try {
            const fixed = await tryRepairPageScaleFromSource(page);
            if (fixed) {
              Store.touchProject(p);
              await save(true);
              renderConditionsList();
              fillScaleSelect();
              updateScaleBadge();
              $('#statusDim').textContent = 'Scale auto-corrected for image resize · verify with From mark…';
            }
          } catch {
            /* ignore */
          }
        }
        planCanvas?.fitToView();
        planCanvas?.draw();
      });
      div.addEventListener('dblclick', () => {
        const name = prompt('Page name:', page.name);
        if (name) {
          page.name = name;
          Store.touchProject(p);
          save();
          renderPagesList();
        }
      });
      box.appendChild(div);
    }
  }

  function fillScaleSelect() {
    const sel = $('#scaleSelect');
    const page = activePage();
    sel.innerHTML = M.PRESET_SCALES.map(
      (s) => `<option value="${s.id}">${s.label}</option>`
    ).join('');
    if (page) {
      sel.value = page.calibrated ? 'custom' : page.scaleId || '1/4';
    }
  }

  function syncToolFromCondition() {
    // Keep tool aligned with active condition when already digitizing
    const c = activeCondition();
    if (!c || !planCanvas) return;
    if (['linear', 'area', 'count'].includes(planCanvas.tool)) {
      const tool = c.style === 'area' ? 'area' : c.style === 'count' ? 'count' : 'linear';
      if (planCanvas.tool !== tool) setTool(tool);
      else {
        updateDigitizeBar();
      }
    }
  }

  function setTool(tool) {
    planCanvas?.setTool(tool);
    $$('#takeoffToolbar [data-tool]').forEach((b) => {
      b.classList.toggle('active-tool', b.dataset.tool === tool);
    });
    $$('[data-linear-mode]').forEach((b) => {
      b.classList.toggle('active-tool', b.dataset.linearMode === (planCanvas?.linearMode || 'segment'));
    });
    if (tool === 'calibrate') {
      $('#takeoffHint').textContent =
        'Calibrate: two clicks on a known dimension, enter real length. Shift = ortho.';
    } else if (tool === 'measure') {
      $('#takeoffHint').textContent =
        'Measure: two clicks for temporary distance. Not saved to conditions.';
    } else if (tool === 'linear') {
      const seg = planCanvas?.linearMode === 'segment';
      $('#takeoffHint').textContent = seg
        ? 'Linear SEGMENT: 2 clicks = 1 run. Space / right-click / Enter finish. Shift = ortho. Change Scale → totals update.'
        : 'Linear POLY: multi-point · Space / right-click / Enter finish · Shift ortho · Select tool to edit marks.';
    } else if (tool === 'area') {
      $('#takeoffHint').textContent =
        'Area: click corners · Space / right-click / Enter / near-start closes · Select tool to move marks.';
    } else if (tool === 'count') {
      $('#takeoffHint').textContent =
        'Count: each click = 1 EA. Select tool to move marks. Right-click pans when not drawing.';
    } else if (tool === 'room') {
      $('#takeoffHint').textContent =
        'Room package: trace floor outline (3+ corners). Auto-creates ceiling, walls, base/trim from package settings. Close near start.';
    } else if (tool === 'deduct') {
      $('#takeoffHint').textContent =
        'Deduct: select parent wall/area first, then outline door/window opening to subtract SF.';
    } else if (tool === 'select') {
      $('#takeoffHint').textContent =
        'Select: drag mark to move · drag grips to reshape · Delete removes · right-drag pans.';
    } else {
      $('#takeoffHint').textContent =
        'Condition → click plan. Space/right-click finish · right-drag pans when idle · V = edit marks.';
    }
    updateDigitizeBar();
    // Refresh DIGITIZING tags without full re-arm
    const box = $('#conditionsList');
    if (box && project()) {
      // light refresh of dig tags only if list already rendered
      renderConditionsList();
    }
  }

  async function syncCanvasImage() {
    const page = activePage();
    if (!planCanvas) return;
    // If page meta says has image but memory is empty, pull from IndexedDB once
    if (page && !pageHasPlan(page) && page.hasImage && project() && Store.hydrateProjectImages) {
      await Store.hydrateProjectImages(project());
    }
    const img = activePage()?.imageDataUrl || null;
    try {
      await planCanvas.loadImage(img);
    } catch (e) {
      console.error('Canvas image load failed', e);
      $('#statusDim').textContent = 'Could not display plan image';
    }
    planCanvas.draw();
  }

  // ---------- condition CRUD ----------
  function addCondition(style) {
    const p = project();
    if (!p) return;
    const defaults = {
      linear: 'Wall / Linear',
      area: 'Floor / Area',
      count: 'Count item',
    };
    const c = M.createCondition(style, {
      number: M.nextConditionNumber(p),
      layerId: p.layers[0]?.id || null,
      name: defaults[style] || 'New condition',
    });
    p.conditions.push(c);
    p.activeConditionId = c.id;
    Store.touchProject(p);
    save();
    // PlanSwift: arm digitize immediately — edit props on double-click, not on create
    armDigitize(c.id);
    $('#statusDim').textContent = `Added “${c.name}” — click the plan to digitize (double-click condition to rename).`;
  }

  function openConditionEditor(id) {
    const p = project();
    const c = p?.conditions.find((x) => x.id === id);
    if (!c) return;
    editingConditionId = id;
    _condEditSnapshot = {
      id: c.id,
      color: c.color,
      number: c.number,
      style: c.style,
      name: c.name,
      type: c.type,
      layerId: c.layerId,
      height: c.height,
      thickness: c.thickness,
      unitPrimary: c.unitPrimary,
      notes: c.notes,
    };
    $('#condNumber').value = c.number;
    $('#condStyle').value = c.style;
    $('#condName').value = c.name;
    const typeSel = $('#condType');
    typeSel.innerHTML = M.CONDITION_TYPES.map(
      (t) => `<option value="${t}" ${t === c.type ? 'selected' : ''}>${t}</option>`
    ).join('');
    const layerSel = $('#condLayer');
    layerSel.innerHTML = p.layers
      .map((l) => `<option value="${l.id}" ${l.id === c.layerId ? 'selected' : ''}>${esc(l.name)}</option>`)
      .join('');
    $('#condColor').value = toHexColor(c.color);
    if ($('#condFillPattern')) {
      $('#condFillPattern').value = c.fillPattern || 'solid';
    }
    if ($('#condFillOpacity')) {
      $('#condFillOpacity').value = c.fillOpacity != null ? c.fillOpacity : 0.22;
    }
    $('#condHeight').value = c.height ?? 0;
    $('#condThickness').value = c.thickness ?? 0;
    $('#condUnit').value = c.unitPrimary || '';
    $('#condNotes').value = c.notes || '';
    _editAssemblies = (c.assemblies || []).map((a) => ({ ...a }));
    renderAssemblyEditor();
    openModal('modalCondition');
  }

  function saveConditionEditor() {
    const p = project();
    const c = p?.conditions.find((x) => x.id === editingConditionId);
    if (!c) return;
    c.number = Number($('#condNumber').value) || c.number;
    c.style = $('#condStyle').value;
    c.name = $('#condName').value.trim() || c.name;
    c.type = $('#condType').value;
    c.layerId = $('#condLayer').value;
    // Normalize color so canvas always receives usable #rrggbb
    c.color = toHexColor($('#condColor').value);
    c.fillPattern = $('#condFillPattern')?.value || 'solid';
    c.fillOpacity = Math.max(0, Math.min(1, Number($('#condFillOpacity')?.value) || 0.22));
    c.height = Number($('#condHeight').value) || 0;
    c.thickness = Number($('#condThickness').value) || 0;
    c.notes = $('#condNotes').value;
    c.assemblies = (_editAssemblies || []).map((a) => ({ ...a }));
    if (c.style === 'linear') {
      c.resultPrimary = 'length';
      c.resultSecondary = 'surface';
      c.unitPrimary = 'LF';
      c.unitSecondary = 'SF';
    } else if (c.style === 'area') {
      c.resultPrimary = 'area';
      c.resultSecondary = 'volume';
      c.unitPrimary = 'SF';
      c.unitSecondary = 'CF';
    } else {
      c.resultPrimary = 'count';
      c.unitPrimary = 'EA';
      c.unitSecondary = null;
    }
    const unitOverride = $('#condUnit').value.trim();
    if (unitOverride && c.style === 'count') c.unitPrimary = unitOverride;
    _condEditSnapshot = null;
    editingConditionId = null;
    Store.touchProject(p);
    save(true); // immediate persist
    closeModal('modalCondition');
    // Keep zoom; force list + canvas redraw with new color
    renderConditionsList();
    updateDigitizeBar();
    planCanvas?.draw();
    refreshTakeoff({ fit: false, rearm: false });
    renderSummary();
    renderEstimate();
    $('#statusDim').textContent = `Updated “${c.name}” · color ${c.color} applied to marks`;
  }

  /** Live color preview while picking in the property dialog */
  function previewConditionColor() {
    const p = project();
    const c = p?.conditions.find((x) => x.id === editingConditionId);
    if (!c || !$('#condColor')) return;
    c.color = toHexColor($('#condColor').value);
    if ($('#condFillPattern')) c.fillPattern = $('#condFillPattern').value;
    if ($('#condFillOpacity')) {
      c.fillOpacity = Math.max(0, Math.min(1, Number($('#condFillOpacity').value) || 0.22));
    }
    planCanvas?.draw();
    // update swatch in list if visible
    const row = $(`#conditionsList .cond-row[data-cond-id="${c.id}"] .cond-swatch`);
    if (row) row.style.background = c.color;
  }

  /**
   * Properties strip for the selected takeoff mark:
   * reassign condition, insert/add points, LF labels.
   */
  function updateMarkPropsBar() {
    const bar = $('#markPropsBar');
    if (!bar) return;
    const p = project();
    const ids = planCanvas?.selectedIds ? [...planCanvas.selectedIds] : [];
    const has = p && ids.length > 0;
    bar.hidden = !has;
    if (!has) {
      planCanvas?.setEditMode(null);
      return;
    }

    const t = p.takeoffs.find((x) => x.id === ids[0]);
    const cond = t && p.conditions.find((c) => c.id === t.conditionId);
    const page = activePage();
    const sel = $('#markReassignCond');
    if (sel) {
      sel.innerHTML = p.conditions
        .map(
          (c) =>
            `<option value="${c.id}" ${t && c.id === t.conditionId ? 'selected' : ''}>${esc(
              `${c.number}. ${c.name} (${c.style})`
            )}</option>`
        )
        .join('');
    }

    let qty = '';
    if (t && cond && page && M.computeObjectQuantity) {
      const q = M.computeObjectQuantity(t, cond, page);
      qty = `${M.formatQty(q.primary)} ${cond.unitPrimary || ''} · ${t.kind} · ${t.geometry?.points?.length || 0} pts`;
    }
    const meta = $('#markPropsMeta');
    if (meta) {
      const mult = t?.multiplier && t.multiplier !== 1 ? ` · ×${t.multiplier}` : '';
      const ded = t?.isDeduction ? ' · DEDUCTION' : '';
      meta.textContent = (qty || '—') + mult + ded;
    }
    if ($('#markMultiplier') && t) {
      $('#markMultiplier').value = t.multiplier || 1;
    }

    // Sync label toggles
    if ($('#chkShowSegLabels')) {
      $('#chkShowSegLabels').checked = p.showSegmentLabels !== false;
    }
    if ($('#chkShowObjTotals')) {
      $('#chkShowObjTotals').checked = p.showObjectTotals !== false;
    }
    planCanvas.showSegmentLabels = p.showSegmentLabels !== false;
    planCanvas.showObjectTotals = p.showObjectTotals !== false;

    // Mode button states
    $('#btnMarkInsert')?.classList.toggle('active-tool', planCanvas.editMode === 'insert');
    $('#btnMarkAppend')?.classList.toggle('active-tool', planCanvas.editMode === 'append');

    // Hint
    if (planCanvas.editMode === 'insert') {
      $('#takeoffHint').textContent =
        'Insert points: click green + on an edge (or double-click edge). Drag grips to reshape. Done / Esc when finished.';
    } else if (planCanvas.editMode === 'append') {
      $('#takeoffHint').textContent =
        'Add points: click to grow the mark (covers missing wall sections). Done / Esc when finished.';
    } else if (ids.length) {
      $('#takeoffHint').textContent =
        'Select: drag mark to move · drag grips to reshape · double-click edge to add a point · use Assign to change condition.';
    }
  }

  function reassignSelectedMark() {
    const p = project();
    if (!p || !planCanvas?.selectedIds?.size) return;
    const newCondId = $('#markReassignCond')?.value;
    if (!newCondId) return;
    const cond = p.conditions.find((c) => c.id === newCondId);
    if (!cond) return;
    let n = 0;
    for (const id of planCanvas.selectedIds) {
      const t = p.takeoffs.find((x) => x.id === id);
      if (t && t.conditionId !== newCondId) {
        t.conditionId = newCondId;
        n++;
      }
    }
    if (n) {
      p.activeConditionId = newCondId;
      Store.touchProject(p);
      save();
      renderConditionsList();
      updateDigitizeBar();
      updateMarkPropsBar();
      planCanvas.draw();
      $('#statusDim').textContent = `Reassigned ${n} mark(s) → ${cond.name}`;
    }
  }

  function readRoomPackageFromModal() {
    const base = M.defaultRoomPackage ? M.defaultRoomPackage() : {};
    return {
      ...base,
      wallHeight: Number($('#roomWallHeight')?.value) || 9,
      ceiling: $('#roomCeil')?.checked !== false,
      walls: $('#roomWalls')?.checked !== false,
      base: $('#roomBase')?.checked !== false,
      crown: !!$('#roomCrown')?.checked,
      chairRail: !!$('#roomChair')?.checked,
      wainscot: !!$('#roomWainscot')?.checked,
      floor: !!$('#roomFloor')?.checked,
      wainscotHeight: Number($('#roomWainscotH')?.value) || 3.5,
    };
  }

  let _pendingRoomOpts = { multiplier: 1, roomName: 'Room' };

  function startRoomTrace() {
    const p = project();
    if (!p || !activePage()) return alert('Open a job and plan first.');
    if (!activePage().feetPerPixel) {
      alert('Set / calibrate scale on this page before room package.');
      return;
    }
    p.roomPackage = readRoomPackageFromModal();
    _pendingRoomOpts = {
      multiplier: Math.max(1, Number($('#roomMultiplier')?.value) || 1),
      roomName: ($('#roomName')?.value || 'Room').trim() || 'Room',
    };
    Store.touchProject(p);
    save();
    closeModal('modalRoom');
    setTool('room');
    $('#statusDim').textContent = `Room “${_pendingRoomOpts.roomName}” · ×${_pendingRoomOpts.multiplier} — trace floor outline`;
  }

  function applyRoomPackageFromPoints(points, pageId) {
    const p = project();
    const page = p?.pages.find((x) => x.id === pageId) || activePage();
    if (!p || !page) return;
    const pkg = p.roomPackage || readRoomPackageFromModal();
    const result = M.buildRoomPackageTakeoffs(p, page, points, pkg, _pendingRoomOpts);
    if (result.error) {
      alert(result.error);
      return;
    }
    for (const obj of result.objects) {
      p.takeoffs.push(obj);
    }
    Store.touchProject(p);
    save();
    renderConditionsList();
    planCanvas?.draw();
    const m = result.metrics || {};
    $('#statusDim').textContent =
      `Room package: ${M.formatQty(m.areaSf)} SF floor/ceil · ${M.formatQty(m.periLf)} LF peri · ` +
      `${M.formatQty(m.wallSf)} SF walls · ×${m.multiplier} · ${result.objects.length} marks`;
    setTool('select');
    // Select ceiling mark for follow-up
    const ceil = result.objects.find((o) => o.role === 'ceiling');
    if (ceil && planCanvas) {
      planCanvas.selectedIds.clear();
      planCanvas.selectedIds.add(ceil.id);
      updateMarkPropsBar();
      planCanvas.draw();
    }
  }

  function applyRoomPackageToSelection() {
    const p = project();
    const page = activePage();
    if (!p || !page || !planCanvas?.selectedIds?.size) {
      return alert('Select an area (polygon) mark first.');
    }
    const id = [...planCanvas.selectedIds][0];
    const t = p.takeoffs.find((x) => x.id === id);
    if (!t || (t.kind !== 'polygon' && t.kind !== 'deduction')) {
      return alert('Selected mark must be an area polygon (trace room or use Area tool).');
    }
    p.roomPackage = readRoomPackageFromModal();
    _pendingRoomOpts = {
      multiplier: Math.max(1, Number($('#roomMultiplier')?.value) || 1),
      roomName: ($('#roomName')?.value || t.label || 'Room').trim() || 'Room',
    };
    closeModal('modalRoom');
    applyRoomPackageFromPoints(t.geometry.points, page.id);
  }

  function setSelectedMultiplier(val) {
    const p = project();
    if (!p || !planCanvas?.selectedIds?.size) return;
    const mult = Math.max(0, Number(val) || 1);
    for (const id of planCanvas.selectedIds) {
      const t = p.takeoffs.find((x) => x.id === id);
      if (t) t.multiplier = mult;
      // Also update sibling room package marks
      if (t?.roomPackageId) {
        for (const s of p.takeoffs) {
          if (s.roomPackageId === t.roomPackageId) s.multiplier = mult;
        }
      }
    }
    Store.touchProject(p);
    save();
    renderConditionsList();
    updateMarkPropsBar();
    planCanvas.draw();
  }

  // ---- Assemblies in condition editor ----
  let _editAssemblies = [];

  function renderAssemblyEditor() {
    const box = $('#condAssemblyList');
    if (!box) return;
    box.innerHTML = (_editAssemblies || [])
      .map(
        (a, i) => `
      <div class="assy-row" data-i="${i}" style="display:grid;grid-template-columns:1.4fr 0.8fr 0.5fr 0.7fr 0.7fr auto;gap:4px;align-items:center">
        <input data-af="description" value="${escAttr(a.description || '')}" placeholder="Description" />
        <select data-af="qtyMode">
          ${['same', 'surface', 'length', 'count', 'fixed']
            .map((m) => `<option value="${m}" ${a.qtyMode === m ? 'selected' : ''}>${m}</option>`)
            .join('')}
        </select>
        <input data-af="factor" type="number" step="0.1" min="0" value="${a.factor ?? 1}" title="Factor / coats" />
        <input data-af="materialUnitCost" type="number" step="0.01" min="0" value="${a.materialUnitCost || 0}" title="Mat $/U" />
        <input data-af="laborUnitCost" type="number" step="0.01" min="0" value="${a.laborUnitCost || 0}" title="Labor $/U" />
        <button type="button" data-del-assy="${i}" class="danger">✕</button>
      </div>`
      )
      .join('') || '<span style="color:var(--text-dim);font-size:12px">No assembly lines — uses condition unit costs only.</span>';

    box.querySelectorAll('[data-af]').forEach((el) => {
      el.addEventListener('change', () => {
        const row = el.closest('.assy-row');
        const i = Number(row?.dataset.i);
        if (!_editAssemblies[i]) return;
        const f = el.dataset.af;
        _editAssemblies[i][f] = ['factor', 'materialUnitCost', 'laborUnitCost'].includes(f)
          ? Number(el.value) || 0
          : el.value;
      });
    });
    box.querySelectorAll('[data-del-assy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _editAssemblies.splice(Number(btn.dataset.delAssy), 1);
        renderAssemblyEditor();
      });
    });
  }

  // ---- Scope / AI — Step 1 Plan-sweep → Step 2 WL Painting proposal ----
  function updateScopeWorkflowUi() {
    const p = project();
    const sp = p?.scopeProposal || {};
    const hasSweep = !!(sp.sweepText && sp.sweepText.trim().length > 80);
    const hasProposal = !!(sp.proposalText && sp.proposalText.trim().length > 80);

    const step1 = $('#scopeStep1');
    const step2 = $('#scopeStep2');
    step1?.classList.toggle('done', hasSweep);
    step1?.classList.toggle('active', !hasSweep);
    step2?.classList.toggle('done', hasProposal);
    step2?.classList.toggle('active', hasSweep && !hasProposal);

    const genBtn = $('#btnAiScope');
    if (genBtn) {
      genBtn.disabled = !hasSweep;
      genBtn.title = hasSweep
        ? 'Build WL Painting proposal from plan-sweep + takeoff quantities'
        : 'Run Step 1 plan-sweep first (Ctrl+click to force without sweep)';
    }

    const sweepMeta = $('#sweepMeta');
    if (sweepMeta) {
      sweepMeta.textContent = hasSweep
        ? `Ready · ${sp.sweepAt ? sp.sweepAt.slice(0, 16).replace('T', ' ') : 'saved'} · ${(sp.sweepText || '').length} chars`
        : 'Not run yet — start here';
    }
    const propMeta = $('#proposalMeta');
    if (propMeta) {
      propMeta.textContent = hasProposal
        ? `Ready · ${sp.proposalAt ? sp.proposalAt.slice(0, 16).replace('T', ' ') : 'saved'} · ${(sp.proposalText || '').length} chars`
        : hasSweep
          ? 'Sweep ready — generate proposal'
          : 'Run after plan-sweep';
    }
  }

  async function refreshScopePanel() {
    const p = project();
    const chip = $('#aiStatusChip');
    try {
      const cfg = await fetch('/api/config').then((r) => r.json());
      const ai = cfg.ai || {};
      if (chip) {
        if (ai.configured) {
          const via =
            (ai.provider || '').includes('PowerShell') || (ai.provider || '').includes('CLI')
              ? 'Grok CLI / PowerShell'
              : ai.model || 'API';
          chip.textContent = `AI: ready (${via})`;
          chip.className = 'chip ok';
          chip.title = ai.hint || ai.provider || '';
        } else {
          chip.textContent = 'AI: install Grok CLI or set XAI_API_KEY';
          chip.className = 'chip bad';
          chip.title = ai.hint || '';
        }
      }
    } catch {
      if (chip) {
        chip.textContent = 'AI: server offline';
        chip.className = 'chip bad';
      }
    }

    // Restore saved notes + both panes
    if (p) {
      if ($('#scopeNotes') && p.scopeProposal?.notes != null) {
        // only restore if empty so user edits aren't wiped mid-type
        if (!$('#scopeNotes').value) $('#scopeNotes').value = p.scopeProposal.notes || '';
      }
      if ($('#sweepOutput')) {
        $('#sweepOutput').value = p.scopeProposal?.sweepText || '';
      }
      if ($('#scopeOutput')) {
        $('#scopeOutput').value =
          p.scopeProposal?.proposalText || p.scopeProposal?.text || '';
      }
    }
    updateScopeWorkflowUi();
  }

  function collectQtyPayload() {
    const p = project();
    if (!p) return [];
    return p.conditions.map((c) => {
      const q = M.aggregateConditionQuantities(p, c.id);
      return {
        name: c.name,
        number: c.number,
        style: c.style,
        type: c.type,
        qty: q.primary,
        unit: c.unitPrimary,
        secondary: q.secondary,
        unit2: c.unitSecondary,
      };
    });
  }

  function setScopeBusy(busy) {
    ['btnAiPlansweep', 'btnAiScope'].forEach((id) => {
      const el = $(`#${id}`);
      if (!el) return;
      if (busy) {
        el.dataset.prevDisabled = el.disabled ? '1' : '0';
        el.disabled = true;
      } else {
        // restore via workflow ui
      }
    });
    if (!busy) updateScopeWorkflowUi();
  }

  async function collectFolderDrawings(p) {
    const list = [];
    try {
      if (p.folderPath && window.PTEstimates?.getProject) {
        const online = await window.PTEstimates.init();
        if (online) {
          const full = await window.PTEstimates.getProject(p.folderPath);
          for (const d of full.drawings || []) {
            list.push({ name: d.name, rel: d.rel || '' });
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
    return list;
  }

  async function buildLiveEvidence(p, notes) {
    const folderDrawings = await collectFolderDrawings(p);
    const SL = window.PTScopeLogic;
    if (!SL) {
      return {
        evidence: null,
        evidenceText: '',
        draftScope: '',
      };
    }
    const evidence = SL.buildEvidencePack(p, { notes, folderDrawings });
    return {
      evidence,
      evidenceText: SL.evidenceToPromptText(evidence),
      draftScope: SL.buildWlScopeDraft(p, evidence, {}),
    };
  }

  async function runAiPlansweep() {
    const p = project();
    if (!p) return;
    const notes = $('#scopeNotes')?.value || '';

    $('#sweepOutput').value =
      'Step 1 - Building evidence pack from THIS job (pages, measured qtys, notes)...\n' +
      'Then Grok writes only real findings with reasons. Wait 30-90s.';
    setScopeBusy(true);
    try {
      const { evidence, evidenceText } = await buildLiveEvidence(p, notes);
      // Show a local preview of facts immediately so user sees it's real data
      if (evidence) {
        const preview = [
          '--- Evidence snapshot (from your file) ---',
          `Job: ${evidence.job.jobNumber || '-'} ${evidence.job.name || ''}`,
          `Pages with plan: ${evidence.stats.pagesWithPlan}/${evidence.stats.pageCount}`,
          `Measured conditions: ${evidence.stats.measuredCount}/${evidence.stats.conditionCount}`,
          `Takeoff marks: ${evidence.stats.takeoffMarks}`,
          `Folder drawings found: ${(evidence.drawings || []).length}`,
          '',
          'Sending to Grok for evidence-based findings...',
        ].join('\n');
        $('#sweepOutput').value = preview;
      }

      const res = await fetch('/api/ai/plansweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job: {
            name: p.name,
            jobNumber: p.jobNumber,
            client: p.client,
            location: p.location,
          },
          evidence_text: evidenceText,
          quantities: collectQtyPayload(),
          notes,
        }),
      });
      const data = await res.json();
      if (!data.ok && data.error) throw new Error(data.error);
      let text = data.text || JSON.stringify(data, null, 2);
      if (
        text.length < 350 &&
        /^(i('|')ll|i will|let me|checking|i'll build)/i.test(text.trim())
      ) {
        text += '\n\n---\nIncomplete AI reply. Click Run plan-sweep again.';
      }
      $('#sweepOutput').value = text;
      p.scopeProposal = {
        ...(p.scopeProposal || {}),
        notes,
        sweepText: text,
        evidenceText,
        sweepAt: new Date().toISOString(),
        proposalText: p.scopeProposal?.proposalText || '',
        text: p.scopeProposal?.proposalText || text,
        lastRun: new Date().toISOString(),
        model: data.model || data.provider || '',
      };
      Store.touchProject(p);
      save();
      $('#statusDim').textContent = `Step 1 evidence sweep ready (${text.length} chars)`;
    } catch (e) {
      $('#sweepOutput').value = 'Error: ' + e.message;
    } finally {
      setScopeBusy(false);
    }
  }

  async function runAiScope(ev) {
    const p = project();
    if (!p) return;
    const notes = $('#scopeNotes')?.value || '';
    const sweepText =
      ($('#sweepOutput')?.value || '').trim() ||
      (p.scopeProposal?.sweepText || '').trim();

    const force = !!(ev && (ev.ctrlKey || ev.metaKey));
    if (!sweepText && !force) {
      alert(
        'Run Step 1 Plan-sweep first.\n\nProposal is built from: (1) logic draft from measured takeoff, (2) evidence sweep findings.\n(Ctrl+click to force without sweep.)'
      );
      return;
    }

    setScopeBusy(true);
    try {
      const { evidenceText, draftScope } = await buildLiveEvidence(p, notes);
      // Always show the logic draft immediately so user sees real qty-driven scope
      $('#scopeOutput').value =
        '--- Logic draft from measured takeoff (source of truth) ---\n\n' +
        draftScope +
        '\n\n--- Polishing with Grok using plan-sweep findings (no invented work)... ---';

      const res = await fetch('/api/ai/scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: p.cover?.company || p.company || 'WL Painting Inc.',
          job: {
            name: p.name,
            jobNumber: p.jobNumber,
            client: p.client,
            location: p.location,
          },
          quantities: collectQtyPayload(),
          notes,
          sweep_text: sweepText,
          evidence_text: evidenceText,
          draft_scope: draftScope,
        }),
      });
      const data = await res.json();
      if (!data.ok && data.error) throw new Error(data.error);
      // Prefer AI polish; if empty, use deterministic draft
      let text = (data.text || '').trim() || draftScope;
      $('#scopeOutput').value = text;
      p.scopeProposal = {
        ...(p.scopeProposal || {}),
        notes,
        sweepText: sweepText || p.scopeProposal?.sweepText || '',
        evidenceText,
        draftScope,
        proposalText: text,
        proposalAt: new Date().toISOString(),
        text,
        lastRun: new Date().toISOString(),
        model: data.model || data.provider || 'logic-draft',
      };
      Store.touchProject(p);
      save();
      $('#statusDim').textContent = `Step 2 scope ready (${text.length} chars) from takeoff logic + sweep`;
    } catch (e) {
      // Still deliver deterministic draft if AI fails
      try {
        const { draftScope } = await buildLiveEvidence(p, notes);
        $('#scopeOutput').value =
          draftScope + '\n\n---\nAI polish failed: ' + e.message + '\n(Showing logic draft from takeoff.)';
      } catch (_) {
        $('#scopeOutput').value = 'Error: ' + e.message;
      }
    } finally {
      setScopeBusy(false);
    }
  }

  function defaultUnit(style) {
    return style === 'linear' ? 'LF' : style === 'area' ? 'SF' : 'EA';
  }

  // ---- Painting suites (office / exterior / cabinets) ----
  let _selectedSuiteId = null;

  function openSuiteModal() {
    if (!project()) {
      alert('Open or create a job first, then load a suite into it.');
      return;
    }
    if (!window.PTPaintingSuites) {
      alert('Painting suites library failed to load. Restart PlanTakeoff.');
      return;
    }
    _selectedSuiteId = project().suiteId || null;
    const box = $('#suiteCards');
    const suites = window.PTPaintingSuites.listSuites();
    box.innerHTML = suites
      .map(
        (s) => `
      <button type="button" class="suite-card ${s.id === _selectedSuiteId ? 'selected' : ''}" data-suite="${s.id}">
        <div class="suite-card-icon">${s.icon || '🎨'}</div>
        <div>
          <h4>${esc(s.name)}</h4>
          <p>${esc(s.blurb)}</p>
          <div class="suite-meta">${s.conditionCount} conditions · ${s.worksheetCount} equipment/supply lines</div>
        </div>
      </button>`
      )
      .join('');
    box.querySelectorAll('[data-suite]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _selectedSuiteId = btn.dataset.suite;
        box.querySelectorAll('.suite-card').forEach((c) => c.classList.remove('selected'));
        btn.classList.add('selected');
        $('#btnApplySuite').disabled = false;
      });
    });
    $('#btnApplySuite').disabled = !_selectedSuiteId;
    openModal('modalSuites');
  }

  function applySelectedSuite() {
    const p = project();
    if (!p || !_selectedSuiteId || !window.PTPaintingSuites) return;
    const mode =
      document.querySelector('input[name="suiteMode"]:checked')?.value === 'merge'
        ? 'merge'
        : 'replace';
    if (mode === 'replace' && (p.conditions?.length || p.takeoffs?.length)) {
      const ok = confirm(
        'Replace current conditions and worksheet lines with this suite?\n\n' +
          'Existing digitized takeoff marks stay on the plan but may point at old condition IDs if you replace.\n' +
          'Prefer applying a suite on a new/empty job, or use Merge.\n\nContinue with Replace?'
      );
      if (!ok) return;
    }
    try {
      const result = window.PTPaintingSuites.applySuite(p, _selectedSuiteId, { mode });
      Store.touchProject(p);
      save(true);
      closeModal('modalSuites');
      renderConditionsList();
      renderLayersList();
      updateDigitizeBar();
      renderWorksheet();
      renderEstimate();
      if ($('#scopeNotes') && p.scopeProposal?.notes) {
        $('#scopeNotes').value = p.scopeProposal.notes;
      }
      planCanvas?.draw();
      $('#statusDim').textContent =
        `Suite loaded: ${p.suiteName} · ${result.conditionCount} conditions · ${result.worksheetCount} gear/supply lines · digitize next`;
      // Arm first condition
      if (p.conditions[0]) armDigitize(p.conditions[0].id);
    } catch (e) {
      alert('Could not apply suite: ' + e.message);
    }
  }

  // ---------- canvas events ----------
  function onCanvasChange(evt) {
    const p = project();
    if (!p) return;

    if (evt.type === 'room-package') {
      applyRoomPackageFromPoints(evt.points, evt.pageId);
      return;
    }
    if (evt.type === 'add-takeoff') {
      p.takeoffs.push(evt.object);
      Hist?.push({ type: 'add', objects: [structuredCloneSafe(evt.object)] });
      Store.touchProject(p);
      save();
      renderConditionsList();
      planCanvas.draw();
      updateScaleBadge();
      updateDigitizeBar();
      // First linear on an uncalibrated page → open scale-from-mark (fixes 6.42 vs 8'-0" class bugs)
      const page = activePage();
      const isLinear =
        evt.object &&
        (evt.object.kind === 'segment' || evt.object.kind === 'polyline');
      if (
        page &&
        !page.calibrated &&
        isLinear &&
        !page._didScalePrompt &&
        (evt.object.geometry?.points?.length || 0) >= 2
      ) {
        page._didScalePrompt = true;
        planCanvas.selectedIds.clear();
        planCanvas.selectedIds.add(evt.object.id);
        const px = M.polylineLengthPx(evt.object.geometry.points);
        const shown = page.feetPerPixel ? px * page.feetPerPixel : null;
        openCalibrateModal(px);
        if (shown != null) {
          $('#statusDim').textContent = `Scale check: mark reads ${M.formatQty(shown, 2)} ft — enter the printed length (e.g. 8 for 8'-0")`;
        }
      }
      return;
    }
    if (evt.type === 'digitize-continue') {
      // Stay armed; refresh qty strip
      renderConditionsList();
      updateDigitizeBar();
      const c = activeCondition();
      if (c) {
        const q = M.aggregateConditionQuantities(p, c.id);
        $('#statusDim').textContent = `${c.name}: ${M.formatQty(q.primary)} ${c.unitPrimary || ''} · ready for next`;
      }
      return;
    }
    if (evt.type === 'selection') {
      // Selecting a takeoff promotes its condition (PlanSwift object → item)
      if (evt.conditionId && evt.conditionId !== p.activeConditionId) {
        p.activeConditionId = evt.conditionId;
        save();
        renderConditionsList();
        updateDigitizeBar();
      }
      updateMarkPropsBar();
      return;
    }
    if (evt.type === 'tool-changed') {
      updateDigitizeBar();
      renderConditionsList();
      return;
    }
    if (evt.type === 'delete-takeoffs') {
      const removed = p.takeoffs.filter((t) => evt.ids.includes(t.id));
      if (removed.length) {
        Hist?.push({ type: 'delete', objects: removed.map(structuredCloneSafe) });
      }
      p.takeoffs = p.takeoffs.filter((t) => !evt.ids.includes(t.id));
      Store.touchProject(p);
      save();
      renderConditionsList();
      updateMarkPropsBar();
      planCanvas.draw();
      return;
    }
    if (evt.type === 'update-takeoff') {
      const t = p.takeoffs.find((x) => x.id === evt.id);
      if (!t) return;
      Hist?.push({
        type: 'geom',
        id: evt.id,
        prevPoints: (evt.prevPoints || []).map((pt) => ({ x: pt.x, y: pt.y })),
        points: (evt.points || []).map((pt) => ({ x: pt.x, y: pt.y })),
      });
      t.geometry = t.geometry || {};
      t.geometry.points = (evt.points || []).map((pt) => ({ x: pt.x, y: pt.y }));
      if (evt.kind) t.kind = evt.kind;
      Store.touchProject(p);
      save();
      renderConditionsList();
      updateMarkPropsBar();
      planCanvas.draw();
      return;
    }
    if (evt.type === 'edit-mode') {
      updateMarkPropsBar();
      return;
    }
    if (evt.type === 'calibrate') {
      openCalibrateModal(evt.pixelDistance);
      setTool('select');
      return;
    }
    if (evt.type === 'measure') {
      const msg =
        evt.feet != null
          ? `Measured ${M.formatQty(evt.feet, 3)} ft (${M.ftIn(evt.feet)}) · ${M.formatQty(evt.pixelDistance, 1)} px`
          : `Measured ${M.formatQty(evt.pixelDistance, 1)} px — calibrate scale for real-world length`;
      $('#statusDim').textContent = msg;
      return;
    }
    if (evt.type === 'status-msg') {
      $('#statusDim').textContent = evt.message || '—';
      return;
    }
  }

  function structuredCloneSafe(obj) {
    try {
      return structuredClone(obj);
    } catch {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  function applyHistoryEntry(entry, direction) {
    const p = project();
    if (!p || !entry) return;
    const isUndo = direction === 'undo';
    if (entry.type === 'add') {
      if (isUndo) {
        const ids = new Set(entry.objects.map((o) => o.id));
        p.takeoffs = p.takeoffs.filter((t) => !ids.has(t.id));
      } else {
        for (const o of entry.objects) {
          if (!p.takeoffs.some((t) => t.id === o.id)) p.takeoffs.push(structuredCloneSafe(o));
        }
      }
    } else if (entry.type === 'delete') {
      if (isUndo) {
        for (const o of entry.objects) {
          if (!p.takeoffs.some((t) => t.id === o.id)) p.takeoffs.push(structuredCloneSafe(o));
        }
      } else {
        const ids = new Set(entry.objects.map((o) => o.id));
        p.takeoffs = p.takeoffs.filter((t) => !ids.has(t.id));
      }
    } else if (entry.type === 'geom') {
      const t = p.takeoffs.find((x) => x.id === entry.id);
      if (t) {
        const pts = isUndo ? entry.prevPoints : entry.points;
        t.geometry = t.geometry || {};
        t.geometry.points = (pts || []).map((pt) => ({ x: pt.x, y: pt.y }));
      }
    }
    Store.touchProject(p);
    save();
    renderConditionsList();
    planCanvas?.draw();
  }

  function undoTakeoff() {
    // Draft vertex undo is handled inside PlanCanvas; if draft active, skip object undo
    if (planCanvas?.draftPoints?.length) return;
    const entry = Hist?.undoOnce();
    if (!entry) {
      $('#statusDim').textContent = 'Nothing to undo';
      return;
    }
    applyHistoryEntry(entry, 'undo');
    $('#statusDim').textContent = 'Undo';
  }

  function redoTakeoff() {
    if (planCanvas?.draftPoints?.length) return;
    const entry = Hist?.redoOnce();
    if (!entry) {
      $('#statusDim').textContent = 'Nothing to redo';
      return;
    }
    applyHistoryEntry(entry, 'redo');
    $('#statusDim').textContent = 'Redo';
  }

  function updateScaleBadge() {
    const el = $('#statusScale');
    if (!el) return;
    const page = activePage();
    if (!page) {
      el.textContent = 'Scale: —';
      el.className = 'scale-badge';
      return;
    }
    if (page.calibrated) {
      el.textContent = 'Scale: Calibrated ✓';
      el.className = 'scale-badge ok';
      el.title = `${M.formatQty(page.feetPerPixel, 6)} ft/pixel`;
    } else {
      const label = M.PRESET_SCALES.find((s) => s.id === page.scaleId)?.label || page.scaleId || '?';
      el.textContent = `Scale: ${label} (verify)`;
      el.className = 'scale-badge warn';
      el.title = 'Preset scale — Calibrate from a known dimension for accurate LF/SF';
    }
  }

  function onCanvasStatus(s) {
    $('#statusZoom').textContent = `${s.zoom}%`;
    $('#statusPage').textContent = s.pageLabel || '—';
    $('#statusDim').textContent = (s.dim || '').trim() || '—';
  }

  function openCalibrateModal(pixelDistance) {
    calibratePx = pixelDistance;
    const page = activePage();
    $('#calPx').textContent = M.formatQty(calibratePx, 1);
    const curFt = page?.feetPerPixel ? calibratePx * page.feetPerPixel : null;
    const el = $('#calCurrentReadout');
    if (el) {
      el.textContent = curFt
        ? `With current scale this mark reads as ${M.formatQty(curFt, 2)} ft (${M.ftIn(curFt)}). If the plan says 8'-0", type 8 — quantities update instantly.`
        : 'No scale yet — enter the printed dimension length (e.g. 8 for 8\'-0").';
    }
    $('#calFeet').value = '';
    $('#calInches').value = '';
    openModal('modalCalibrate');
    setTimeout(() => $('#calFeet')?.focus(), 50);
  }

  /**
   * Use a selected linear mark (or last linear on page) as the calibration stick.
   * Example: mark the 4'-6" dimension line, click From mark…, enter 4'6".
   */
  function scaleFromSelectedMark() {
    const p = project();
    const page = activePage();
    if (!p || !page) return alert('Open a job and page first.');

    let t = null;
    const sel = planCanvas?.selectedIds;
    if (sel && sel.size) {
      const id = [...sel][0];
      t = p.takeoffs.find((x) => x.id === id && x.pageId === page.id);
    }
    if (!t) {
      // last linear-ish takeoff on this page
      const linears = p.takeoffs.filter(
        (x) =>
          x.pageId === page.id &&
          (x.kind === 'segment' || x.kind === 'polyline') &&
          (x.geometry?.points?.length || 0) >= 2
      );
      t = linears[linears.length - 1] || null;
    }
    if (!t || (t.geometry?.points?.length || 0) < 2) {
      alert(
        'Draw or select a linear mark along a known dimension first.\n\n' +
          'Example: mark the line labeled 4\'-6", keep it selected, click From mark…, type 4\'6".'
      );
      setTool('linear');
      return;
    }
    const px = M.polylineLengthPx(t.geometry.points);
    if (!(px > 0)) return alert('Mark has no length.');
    openCalibrateModal(px);
    planCanvas.selectedIds.clear();
    planCanvas.selectedIds.add(t.id);
    planCanvas.draw();
  }

  function applyCalibrate() {
    const page = activePage();
    const p = project();
    if (!page || !p || !calibratePx) return;
    const feetRaw = ($('#calFeet').value || '').trim();
    const inchesRaw = ($('#calInches').value || '').trim();
    let feet = 0;
    if (feetRaw && /['′'′"″ft\-\s]/i.test(feetRaw) && !/^\d+(\.\d+)?$/.test(feetRaw)) {
      feet = M.parseLenInput(feetRaw);
    } else if (feetRaw) {
      feet = Number(feetRaw) || 0;
      const inches = Number(inchesRaw) || 0;
      feet += inches / 12;
    }
    // Also accept pure parseLenInput for 4'6"
    if (!(feet > 0)) feet = M.parseLenInput(feetRaw);
    if (!(feet > 0) || Number.isNaN(feet)) {
      return alert('Enter the printed length (e.g. 4\'6" or 4.5 or 20).');
    }
    page.feetPerPixel = feet / calibratePx;
    page.calibrated = true;
    page.scaleId = 'custom';
    page.scaleSource = 'calibrated';
    Store.touchProject(p);
    save();
    closeModal('modalCalibrate');
    fillScaleSelect();
    refreshQuantitiesAfterScaleChange();
    const check = calibratePx * page.feetPerPixel;
    $('#statusDim').textContent = `Calibrated: mark = ${M.ftIn(check)} · all LF/SF on this page updated`;
  }

  function onScaleChange() {
    const page = activePage();
    const p = project();
    if (!page || !p) return;
    const scaleId = $('#scaleSelect').value;
    if (scaleId === 'custom') {
      if (!page.feetPerPixel) {
        alert('Use Calibrate… or From mark… with a known dimension on the plan.');
        fillScaleSelect();
        return;
      }
      page.scaleId = 'custom';
      page.calibrated = true;
      page.scaleSource = 'calibrated';
    } else {
      page.scaleId = scaleId;
      page.calibrated = false;
      page.scaleSource = 'preset';
      // Prefer renderDpi/pixelScale (correct after pack downscale)
      if (page.renderDpi && page.pixelScale > 0) {
        page.dpi = effectiveDpi(page.renderDpi, page.pixelScale);
      } else {
        page.dpi = page.dpi || 96;
      }
      page.feetPerPixel = M.feetPerPixelFromScale(scaleId, page.dpi);
    }
    Store.touchProject(p);
    save();
    refreshQuantitiesAfterScaleChange();
    if (!page.calibrated) {
      $('#statusDim').textContent =
        `Preset ${M.PRESET_SCALES.find((s) => s.id === scaleId)?.label || scaleId} applied — verify with Calibrate / From mark on a known dim`;
    }
  }

  function refreshQuantitiesAfterScaleChange() {
    const page = activePage();
    const label = page?.calibrated
      ? 'Calibrated ✓'
      : M.PRESET_SCALES.find((s) => s.id === page?.scaleId)?.label || page?.scaleId || 'scale';
    renderConditionsList();
    renderPagesList();
    updateScaleBadge();
    renderSummary();
    renderEstimate();
    planCanvas?.draw();
    planCanvas?._emitStatus?.(planCanvas.hover);
    $('#statusDim').textContent = `Scale → ${label} · quantities updated (this page)`;
  }

  async function loadPlanFile(file) {
    const page = activePage();
    const p = project();
    if (!page || !p) return alert('Open a bid first.');

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    try {
      $('#statusDim').textContent = isPdf ? 'Rendering PDF…' : 'Loading image…';

      if (isPdf) {
        if (!window.PTPdf) throw new Error('PDF loader missing — refresh the page (Ctrl+F5)');
        // Offer multi-page import when PDF has several sheets
        const buf = await file.arrayBuffer();
        const pdf = await window.PTPdf.openPdf(buf);
        if (pdf.numPages > 1) {
          const choice = window.prompt(
            `"${file.name}" has ${pdf.numPages} pages.\n\n` +
              `Enter page number (1–${pdf.numPages}),\n` +
              `or type ALL to import every page as separate takeoff pages (max 25):`,
            '1'
          );
          if (choice == null) {
            $('#statusDim').textContent = '—';
            return;
          }
          if (String(choice).trim().toUpperCase() === 'ALL') {
            const max = Math.min(pdf.numPages, 25);
            const renderScale = 2.0;
            const renderDpi = Math.round(72 * renderScale);
            // replace current empty page first, then add more
            for (let i = 1; i <= max; i++) {
              const rendered = await window.PTPdf.renderPageToDataUrl(pdf, i, renderScale);
              const autoName = nameFromPlanFile(file.name, i, max);
              if (i === 1) {
                // applyRenderedPlan packs + applies effective DPI
                await applyRenderedPlan(rendered.dataUrl, rendered.width, rendered.height, autoName, {
                  dpi: renderDpi,
                  pdfPage: i,
                  forceName: true,
                });
              } else {
                const packed = await packPlanImage(rendered.dataUrl, rendered.width, rendered.height);
                const dpi = effectiveDpi(renderDpi, packed.pixelScale);
                const newPage = M.createPage({
                  name: nextPageName(p, autoName),
                  pageNumber: p.pages.length + 1,
                  scaleId: page.scaleId || '1/4',
                  dpi,
                  feetPerPixel: M.feetPerPixelFromScale(page.scaleId || '1/4', dpi),
                  imageDataUrl: packed.dataUrl,
                  imageWidth: packed.w,
                  imageHeight: packed.h,
                });
                newPage.hasImage = true;
                newPage.renderDpi = renderDpi;
                newPage.pixelScale = packed.pixelScale || 1;
                newPage.pdfPage = i;
                p.pages.push(newPage);
              }
            }
            p.activePageId = p.pages[0].id;
            Store.touchProject(p);
            await save(true);
            await syncCanvasImage();
            planCanvas?.fitToView();
            planCanvas?.draw();
            renderPagesList();
            updateScaleBadge();
            $('#statusDim').textContent = `Loaded ${max} PDF pages`;
            if (pdf.numPages > 25) {
              alert(`Imported first 25 of ${pdf.numPages} pages. Add more via Load Plan Image.`);
            }
            return;
          }
          const pageNum = parseInt(choice, 10);
          if (!pageNum || pageNum < 1 || pageNum > pdf.numPages) {
            throw new Error(`Invalid page (1–${pdf.numPages})`);
          }
          const rendered = await window.PTPdf.renderPageToDataUrl(pdf, pageNum, 2.5);
          await applyRenderedPlan(
            rendered.dataUrl,
            rendered.width,
            rendered.height,
            nameFromPlanFile(file.name, pageNum, pdf.numPages),
            { dpi: 180, pdfPage: pageNum, forceName: true }
          );
          $('#statusDim').textContent = `PDF page ${pageNum}/${pdf.numPages} loaded`;
          return;
        }
        const rendered = await window.PTPdf.renderPageToDataUrl(pdf, 1, 2.5);
        await applyRenderedPlan(
          rendered.dataUrl,
          rendered.width,
          rendered.height,
          nameFromPlanFile(file.name, 1, 1),
          { dpi: 180, pdfPage: 1, forceName: true }
        );
        $('#statusDim').textContent = 'PDF loaded';
        return;
      }

      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImageEl(dataUrl);
      await applyRenderedPlan(
        dataUrl,
        img.width,
        img.height,
        nameFromPlanFile(file.name),
        { forceName: true }
      );
      $('#statusDim').textContent = 'Plan loaded';
    } catch (e) {
      console.error(e);
      alert('Could not load plan: ' + e.message);
      $('#statusDim').textContent = '—';
    }
  }

  // ---------- summary / estimate ----------
  function renderSummary() {
    const p = project();
    const tbody = $('#summaryTable tbody');
    tbody.innerHTML = '';
    if (!p) return;
    const hideZero = $('#summaryHideZero')?.checked;

    for (const c of p.conditions) {
      const q = M.aggregateConditionQuantities(p, c.id);
      if (hideZero && q.primary === 0 && q.count === 0) continue;
      const layer = p.layers.find((l) => l.id === c.layerId);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.number}</td>
        <td><span class="color-dot" style="background:${c.color}"></span>${esc(c.name)}</td>
        <td><span class="badge ${c.style}">${c.style}</span></td>
        <td>${esc(c.type)}</td>
        <td>${esc(layer?.name || '—')}</td>
        <td class="num">${q.count}</td>
        <td class="num">${M.formatQty(q.primary)}</td>
        <td>${esc(c.unitPrimary || '')}</td>
        <td class="num">${c.unitSecondary ? M.formatQty(q.secondary) : '—'}</td>
        <td>${esc(c.unitSecondary || '')}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function renderEstimate() {
    const p = project();
    const tbody = $('#estimateTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!p) return;
    const hideZero = $('#estimateHideZero')?.checked;

    const full =
      typeof M.buildFullEstimate === 'function'
        ? M.buildFullEstimate(p, { hideZero })
        : { takeoffLines: [], gearLines: [], takeoff: {}, gear: {}, totals: { grand: 0 } };

    const addSection = (title, sub) => {
      const tr = document.createElement('tr');
      tr.className = 'est-section-row';
      tr.innerHTML = `<td colspan="13"><strong>${esc(title)}</strong> <span style="color:var(--text-dim);font-weight:500">${esc(
        sub || ''
      )}</span></td>`;
      tbody.appendChild(tr);
    };

    const addLine = (line) => {
      const tr = document.createElement('tr');
      const tag = line.isWorksheet
        ? ' <span class="badge">gear</span>'
        : line.isAssembly
          ? ' <span class="badge">assy</span>'
          : '';
      const modeHint =
        line.qtyMode && line.qtyMode !== 'same'
          ? ` <span style="color:var(--text-dim);font-size:10px">[${line.qtyMode}${
              line.factor && line.factor !== 1 ? '×' + line.factor : ''
            }]</span>`
          : '';
      tr.innerHTML = `
        <td>${esc(line.number ?? '')}</td>
        <td>${line.isAssembly || line.isWorksheet ? '↳ ' : ''}${esc(line.name)}${tag}${modeHint}</td>
        <td class="num">${M.formatQty(line.qty)}</td>
        <td>${esc(line.unit || '')}</td>
        <td class="num">${M.formatQty(line.materialUnitCost, 2)}</td>
        <td class="num">${M.formatQty(line.laborUnitCost, 2)}</td>
        <td class="num">${M.formatQty(line.equipmentUnitCost || 0, 2)}</td>
        <td class="num">${M.formatQty(line.otherUnitCost || 0, 2)}</td>
        <td class="num">${money(line.material)}</td>
        <td class="num">${money(line.labor)}</td>
        <td class="num">${money(line.equipment || 0)}</td>
        <td class="num">${money(line.other || 0)}</td>
        <td class="num"><strong>${money(line.total)}</strong></td>
      `;
      tbody.appendChild(tr);
    };

    // --- Takeoff / paint systems ---
    addSection(
      'A. Takeoff & paint systems',
      `(${full.takeoffLines.length} lines · assemblies from suite conditions)`
    );
    if (!full.takeoffLines.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td colspan="13" style="color:var(--text-dim)">No measured takeoff yet — load a suite and digitize, or uncheck “hide zero”.</td>';
      tbody.appendChild(tr);
    } else {
      full.takeoffLines.forEach(addLine);
    }

    // --- Gear / supplies / mobilization ---
    addSection(
      'B. Equipment, supplies & mobilization',
      `(${full.gearLines.length} worksheet lines · always included in grand total)`
    );
    if (!full.gearLines.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td colspan="13" style="color:var(--text-dim)">No worksheet gear lines — load a painting suite or add lines on Worksheet tab.</td>';
      tbody.appendChild(tr);
    } else {
      full.gearLines.forEach(addLine);
    }

    const T = full.totals || {};
    const tk = full.takeoff || {};
    const g = full.gear || {};
    $('#estimateTotals').innerHTML = `
      <span><span class="t-label">Paint mat</span><span class="t-val money">${money(tk.material || 0)}</span></span>
      <span><span class="t-label">Paint labor</span><span class="t-val money">${money(tk.labor || 0)}</span></span>
      <span><span class="t-label">Gear mat</span><span class="t-val money">${money(g.material || 0)}</span></span>
      <span><span class="t-label">Gear labor</span><span class="t-val money">${money(g.labor || 0)}</span></span>
      <span><span class="t-label">Equipment</span><span class="t-val money">${money(T.equipment || 0)}</span></span>
      <span><span class="t-label">Other</span><span class="t-val money">${money(T.other || 0)}</span></span>
      <span><span class="t-label">Grand Total</span><span class="t-val money">${money(T.grand || 0)}</span></span>
    `;
  }

  // ---------- worksheet ----------
  function renderWorksheet() {
    const p = project();
    const tbody = $('#worksheetTable tbody');
    tbody.innerHTML = '';
    if (!p) return;
    if (!p.worksheet) p.worksheet = [];

    let total = 0;
    for (const line of p.worksheet) {
      const ext =
        (Number(line.quantity) || 0) *
          ((Number(line.material) || 0) +
            (Number(line.labor) || 0) +
            (Number(line.equipment) || 0) +
            (Number(line.other) || 0)) ||
        (Number(line.material) || 0) +
          (Number(line.labor) || 0) +
          (Number(line.equipment) || 0) +
          (Number(line.other) || 0);
      // simpler: sum cost columns * qty if qty else sum costs as lump
      const unitSum =
        (Number(line.material) || 0) +
        (Number(line.labor) || 0) +
        (Number(line.equipment) || 0) +
        (Number(line.other) || 0);
      const lineTotal = (Number(line.quantity) || 0) * unitSum;
      total += lineTotal;

      const tr = document.createElement('tr');
      if (line.id === selectedWorksheetLineId) tr.classList.add('selected');
      tr.innerHTML = `
        <td><input class="cell" data-f="code" data-id="${line.id}" value="${escAttr(line.code)}" /></td>
        <td><input class="cell" data-f="description" data-id="${line.id}" value="${escAttr(line.description)}" /></td>
        <td class="num"><input class="cell" type="number" data-f="quantity" data-id="${line.id}" value="${line.quantity}" /></td>
        <td><input class="cell" data-f="unit" data-id="${line.id}" value="${escAttr(line.unit)}" /></td>
        <td class="num"><input class="cell" type="number" data-f="material" data-id="${line.id}" value="${line.material}" /></td>
        <td class="num"><input class="cell" type="number" data-f="labor" data-id="${line.id}" value="${line.labor}" /></td>
        <td class="num"><input class="cell" type="number" data-f="equipment" data-id="${line.id}" value="${line.equipment}" /></td>
        <td class="num"><input class="cell" type="number" data-f="other" data-id="${line.id}" value="${line.other}" /></td>
        <td class="num">${money(lineTotal)}</td>
      `;
      tr.addEventListener('click', () => {
        selectedWorksheetLineId = line.id;
        renderWorksheet();
      });
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('input[data-f]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const line = p.worksheet.find((x) => x.id === inp.dataset.id);
        if (!line) return;
        const f = inp.dataset.f;
        line[f] = ['quantity', 'material', 'labor', 'equipment', 'other'].includes(f)
          ? Number(inp.value) || 0
          : inp.value;
        Store.touchProject(p);
        save();
        renderWorksheet();
        renderEstimate();
      });
    });

    $('#worksheetTotals').innerHTML = `
      <span><span class="t-label">Worksheet Total</span><span class="t-val money">${money(total)}</span></span>
      <span style="color:var(--text-dim);font-size:11px">Included in Estimate grand total</span>
    `;
  }

  // ---------- budget / notes ----------
  function estimateGrandTotal(p) {
    if (typeof M.buildFullEstimate === 'function') {
      return M.buildFullEstimate(p, { hideZero: false }).totals.grand || 0;
    }
    let t = 0;
    for (const c of p.conditions) {
      const q = M.aggregateConditionQuantities(p, c.id);
      t +=
        q.primary *
        ((c.materialUnitCost || 0) + (c.laborUnitCost || 0) + (c.subUnitCost || 0));
    }
    return t;
  }

  function renderBudget() {
    const p = project();
    if (!p) return;
    if (!p.budget) p.budget = { totalBudget: 0, contingencyPct: 5, lines: [] };
    $('#budgetTotal').value = p.budget.totalBudget;
    $('#budgetContingency').value = p.budget.contingencyPct;
    const est = estimateGrandTotal(p);
    const bud = Number(p.budget.totalBudget) || 0;
    const cont = bud * ((Number(p.budget.contingencyPct) || 0) / 100);
    const avail = bud - cont;
    const delta = avail - est;
    $('#budgetCompare').textContent =
      `Estimate ${money(est)}  ·  Budget ${money(bud)}  ·  After contingency ${money(avail)}  ·  ${
        delta >= 0 ? 'Under' : 'Over'
      } ${money(Math.abs(delta))}`;
  }

  function renderNotes() {
    const p = project();
    const box = $('#notesList');
    if (!p) {
      box.innerHTML = '';
      return;
    }
    if (!p.notes) p.notes = [];
    box.innerHTML = p.notes
      .map(
        (n) => `
      <div class="card" style="margin-bottom:10px" data-note="${n.id}">
        <h3 contenteditable="true" data-nf="title">${esc(n.title)}</h3>
        <p contenteditable="true" data-nf="body" style="min-height:40px;color:var(--text)">${esc(n.body)}</p>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
          <span class="chip">${esc((n.createdAt || '').slice(0, 10))}</span>
          <button type="button" class="danger" data-del-note="${n.id}">Delete</button>
        </div>
      </div>`
      )
      .join('');

    box.querySelectorAll('[data-nf]').forEach((el) => {
      el.addEventListener('blur', () => {
        const card = el.closest('[data-note]');
        const note = p.notes.find((x) => x.id === card.dataset.note);
        if (!note) return;
        note[el.dataset.nf] = el.innerText.trim();
        Store.touchProject(p);
        save();
      });
    });
    box.querySelectorAll('[data-del-note]').forEach((btn) => {
      btn.addEventListener('click', () => {
        p.notes = p.notes.filter((n) => n.id !== btn.dataset.delNote);
        Store.touchProject(p);
        save();
        renderNotes();
      });
    });
  }

  // ---------- export ----------
  function exportSummaryCsv() {
    const p = project();
    if (!p) return;
    const rows = [['Number', 'Name', 'Style', 'Type', 'Primary', 'Unit', 'Secondary', 'Unit2', 'Objects']];
    for (const c of p.conditions) {
      const q = M.aggregateConditionQuantities(p, c.id);
      rows.push([
        c.number,
        c.name,
        c.style,
        c.type,
        q.primary,
        c.unitPrimary,
        q.secondary,
        c.unitSecondary || '',
        q.count,
      ]);
    }
    downloadText(`${p.jobNumber || p.name}-summary.csv`, rows.map((r) => r.join(',')).join('\n'));
  }

  function exportEstimateCsv() {
    const p = project();
    if (!p) return;
    const full =
      typeof M.buildFullEstimate === 'function'
        ? M.buildFullEstimate(p, { hideZero: false })
        : { takeoffLines: [], gearLines: [], totals: {} };
    const rows = [
      [
        'Section',
        'Code',
        'Description',
        'Qty',
        'Unit',
        'MatUnit',
        'LabUnit',
        'EquipUnit',
        'OtherUnit',
        'Material',
        'Labor',
        'Equipment',
        'Other',
        'Total',
      ],
    ];
    const push = (section, line) => {
      rows.push([
        section,
        line.number ?? '',
        `"${String(line.name || '').replace(/"/g, '""')}"`,
        line.qty,
        line.unit,
        line.materialUnitCost,
        line.laborUnitCost,
        line.equipmentUnitCost || 0,
        line.otherUnitCost || 0,
        line.material,
        line.labor,
        line.equipment || 0,
        line.other || 0,
        line.total,
      ]);
    };
    (full.takeoffLines || []).forEach((l) => push('Takeoff/Assembly', l));
    (full.gearLines || []).forEach((l) => push('Gear/Supplies', l));
    const T = full.totals || {};
    rows.push([]);
    rows.push([
      'TOTALS',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      T.material || 0,
      T.labor || 0,
      T.equipment || 0,
      T.other || 0,
      T.grand || 0,
    ]);
    downloadText(`${p.jobNumber || p.name}-estimate.csv`, rows.map((r) => r.join(',')).join('\n'));
  }

  // ---------- utils ----------
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }
  function toHexColor(c) {
    if (!c || typeof c !== 'string') return '#e74c3c';
    const s = c.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return (`#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`).toLowerCase();
    }
    const rgb = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) {
      const h = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
      return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
    }
    // named / other — keep if non-empty for canvas; color input needs hex
    if (s.startsWith('#')) return '#e74c3c';
    return s || '#e74c3c';
  }
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  // ---------- wire UI ----------
  async function init() {
    $('#statusDate').textContent = new Date().toLocaleDateString();

    // tabs
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // projects
    $('#btnNewProject').addEventListener('click', newProject);
    $('#menuFileNew').addEventListener('click', newProject);
    $('#btnDuplicateProject').addEventListener('click', duplicateProject);
    $('#btnDeleteProject').addEventListener('click', deleteProject);
    $('#projectFilter').addEventListener('input', renderProjects);

    // estimates library + folders
    $('#btnScanLibrary')?.addEventListener('click', scanLibrary);
    $('#btnRefreshLibrary')?.addEventListener('click', refreshLibraryUi);
    $('#libraryYear')?.addEventListener('change', scanLibrary);
    $('#libraryFilter')?.addEventListener('input', renderLibraryFiltered);
    $('#menuScanEstimates')?.addEventListener('click', () => {
      switchTab('library');
      scanLibrary();
    });
    $('#menuNewFolders')?.addEventListener('click', () => switchTab('folders'));
    $('#btnSuggestCode')?.addEventListener('click', async () => {
      const E = window.PTEstimates;
      if (!(await E.init())) return alert('Start Launch PlanTakeoff.bat first.');
      const s = await E.suggestCode(
        Number($('#folderYear').value),
        $('#folderMonth').value || undefined
      );
      $('#folderCode').value = s.code;
    });
    $('#btnCreateFolder')?.addEventListener('click', createOneFolder);
    $('#btnCreateBatch')?.addEventListener('click', createBatchFolders);

    // takeoff tools
    $$('#takeoffToolbar [data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tool === 'room') {
          openModal('modalRoom');
          return;
        }
        setTool(btn.dataset.tool);
      });
    });
    $('#btnCalibrate').addEventListener('click', () => setTool('calibrate'));
    $('#btnScaleFromMark')?.addEventListener('click', scaleFromSelectedMark);
    // Click yellow "Scale: … (verify)" badge → same as From mark…
    $('#statusScale')?.addEventListener('click', () => scaleFromSelectedMark());
    $('#statusScale')?.style && (($('#statusScale').style.cursor = 'pointer'));
    $('#btnApplyCalibrate')?.addEventListener('click', applyCalibrate);
    $$('.cal-quick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const len = Number(btn.dataset.len);
        if (!(len > 0)) return;
        $('#calFeet').value = String(len);
        $('#calInches').value = '';
        applyCalibrate();
      });
    });
    // Enter in calibrate length field applies
    $('#calFeet')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCalibrate();
      }
    });
    $('#btnFitView').addEventListener('click', () => {
      planCanvas?.fitToView();
      planCanvas?.draw();
    });
    $('#menuFit').addEventListener('click', () => {
      planCanvas?.fitToView();
      planCanvas?.draw();
    });
    $('#scaleSelect').addEventListener('change', onScaleChange);
    $('#btnLoadPlan').addEventListener('click', () => $('#filePlan').click());
    $('#menuImportPlan').addEventListener('click', () => {
      if (!project()) {
        alert('Open or create a bid first.');
        return;
      }
      switchTab('takeoff');
      $('#filePlan').click();
    });
    $('#filePlan').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) await loadPlanFile(f);
    });
    $('#btnDeleteTakeoff').addEventListener('click', () => {
      if (planCanvas?.selectedIds?.size) {
        onCanvasChange({ type: 'delete-takeoffs', ids: [...planCanvas.selectedIds] });
        planCanvas.selectedIds.clear();
      }
    });

    // Global undo/redo + condition hotkeys (PlanSwift-style)
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (planCanvas?.draftPoints?.length) return; // canvas pops vertex
        e.preventDefault();
        if (e.shiftKey) redoTakeoff();
        else undoTakeoff();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoTakeoff();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // Number keys 1–9 → condition by number
        if (/^[1-9]$/.test(e.key)) {
          const p = project();
          const c = p?.conditions.find((x) => String(x.number) === e.key);
          if (c) {
            e.preventDefault();
            armDigitize(c.id);
          }
        }
        // Tab → next condition
        if (e.key === 'Tab' && project()?.conditions?.length) {
          e.preventDefault();
          const p = project();
          const list = p.conditions;
          const idx = list.findIndex((x) => x.id === p.activeConditionId);
          const next = list[(idx + 1) % list.length];
          armDigitize(next.id);
        }
      }
    });

    // Linear segment vs polyline (PlanSwift-style wall speed)
    $$('[data-linear-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        planCanvas?.setLinearMode(btn.dataset.linearMode);
        if (planCanvas && planCanvas.tool !== 'linear') setTool('linear');
        else setTool(planCanvas?.tool || 'linear');
      });
    });

    $('#btnAddLinear').addEventListener('click', () => addCondition('linear'));
    $('#btnAddArea').addEventListener('click', () => addCondition('area'));
    $('#btnAddCount').addEventListener('click', () => addCondition('count'));
    $('#btnEditCond').addEventListener('click', () => {
      const c = activeCondition();
      if (c) openConditionEditor(c.id);
    });
    $('#btnLoadSuite')?.addEventListener('click', openSuiteModal);
    $('#btnApplySuite')?.addEventListener('click', applySelectedSuite);
    $('#btnSaveCondition').addEventListener('click', saveConditionEditor);
    // Live color on plan while dragging the color picker
    $('#condColor')?.addEventListener('input', previewConditionColor);
    $('#condFillPattern')?.addEventListener('change', previewConditionColor);
    $('#condFillOpacity')?.addEventListener('input', previewConditionColor);
    // btnApplyCalibrate already bound above with quick-picks — do not double-bind
    // Condition Cancel/X/backdrop → closeModal restores color via _condEditSnapshot

    // Selected mark properties
    $('#markReassignCond')?.addEventListener('change', reassignSelectedMark);
    $('#btnMarkInsert')?.addEventListener('click', () => {
      if (!planCanvas?.selectedIds?.size) return;
      setTool('select');
      planCanvas.setEditMode(planCanvas.editMode === 'insert' ? null : 'insert');
      updateMarkPropsBar();
    });
    $('#btnMarkAppend')?.addEventListener('click', () => {
      if (!planCanvas?.selectedIds?.size) return;
      setTool('select');
      planCanvas.setEditMode(planCanvas.editMode === 'append' ? null : 'append');
      updateMarkPropsBar();
    });
    $('#btnMarkDelVertex')?.addEventListener('click', () => {
      planCanvas?._deleteSelectedVertex?.();
      updateMarkPropsBar();
    });
    $('#btnMarkToArea')?.addEventListener('click', () => {
      if (planCanvas?.convertSelectionToArea?.()) {
        $('#statusDim').textContent =
          'Closed as area polygon. Use Assign to if you want an Area condition (SF).';
        updateMarkPropsBar();
        renderConditionsList();
      } else {
        alert('Need a linear mark with at least 3 points selected to close as area.');
      }
    });
    $('#btnMarkDoneEdit')?.addEventListener('click', () => {
      planCanvas?.setEditMode(null);
      updateMarkPropsBar();
    });
    $('#chkShowSegLabels')?.addEventListener('change', () => {
      const p = project();
      if (!p) return;
      p.showSegmentLabels = $('#chkShowSegLabels').checked;
      planCanvas?.setShowSegmentLabels(p.showSegmentLabels);
      Store.touchProject(p);
      save();
    });
    $('#chkShowObjTotals')?.addEventListener('change', () => {
      const p = project();
      if (!p) return;
      p.showObjectTotals = $('#chkShowObjTotals').checked;
      planCanvas?.setShowObjectTotals(p.showObjectTotals);
      Store.touchProject(p);
      save();
    });
    $('#markMultiplier')?.addEventListener('change', () => {
      setSelectedMultiplier($('#markMultiplier').value);
    });
    $('#btnMarkRoomPack')?.addEventListener('click', () => {
      openModal('modalRoom');
    });
    $('#btnRoomStart')?.addEventListener('click', startRoomTrace);
    $('#btnRoomFromSelection')?.addEventListener('click', applyRoomPackageToSelection);
    $('#btnAddAssembly')?.addEventListener('click', () => {
      _editAssemblies.push(
        M.createAssemblyLine
          ? M.createAssemblyLine({ description: 'New line', factor: 1 })
          : { id: M.uid(), description: 'New line', qtyMode: 'same', factor: 1, materialUnitCost: 0, laborUnitCost: 0 }
      );
      renderAssemblyEditor();
    });
    $('#btnAiScope')?.addEventListener('click', (e) => runAiScope(e));
    $('#btnAiPlansweep')?.addEventListener('click', runAiPlansweep);
    $('#btnAiCopy')?.addEventListener('click', () => {
      const t = $('#scopeOutput')?.value || '';
      navigator.clipboard?.writeText(t);
      $('#statusDim').textContent = 'Proposal copied';
    });
    $('#btnAiCopySweep')?.addEventListener('click', () => {
      const t = $('#sweepOutput')?.value || '';
      navigator.clipboard?.writeText(t);
      $('#statusDim').textContent = 'Plan-sweep copied';
    });
    // Persist notes as user types (debounced lightly via change)
    $('#scopeNotes')?.addEventListener('change', () => {
      const p = project();
      if (!p) return;
      p.scopeProposal = { ...(p.scopeProposal || {}), notes: $('#scopeNotes').value };
      Store.touchProject(p);
      save();
    });
    // If user edits sweep manually, keep proposal button enabled
    $('#sweepOutput')?.addEventListener('input', () => {
      const p = project();
      if (!p) return;
      const t = $('#sweepOutput').value || '';
      if (t.trim().length > 80) {
        p.scopeProposal = {
          ...(p.scopeProposal || {}),
          sweepText: t,
        };
        updateScopeWorkflowUi();
      }
    });

    $('#btnAddLayer').addEventListener('click', () => {
      const p = project();
      if (!p) return;
      const name = prompt('Layer name:', 'New Layer');
      if (!name) return;
      p.layers.push(M.createLayer({ name }));
      Store.touchProject(p);
      save();
      renderLayersList();
    });
    $('#btnAddPage').addEventListener('click', () => {
      const p = project();
      if (!p) return;
      const n = p.pages.length + 1;
      const page = M.createPage({
        name: nextPageName(p, `Sheet ${n}`),
        pageNumber: n,
        feetPerPixel: M.feetPerPixelFromScale('1/4', 96),
      });
      p.pages.push(page);
      p.activePageId = page.id;
      Store.touchProject(p);
      save();
      refreshTakeoff();
      $('#statusDim').textContent = `Added page “${page.name}” — load a plan onto it`;
    });

    // summary / estimate
    $('#summaryHideZero')?.addEventListener('change', renderSummary);
    $('#estimateHideZero')?.addEventListener('change', renderEstimate);
    $('#btnExportSummaryCsv')?.addEventListener('click', exportSummaryCsv);
    $('#btnExportEstimateCsv')?.addEventListener('click', exportEstimateCsv);
    $('#btnGotoWorksheet')?.addEventListener('click', () => {
      // Ensure worksheet tab is visible
      if (state.visibleOptionalTabs) state.visibleOptionalTabs.worksheet = true;
      applyTabVisibility();
      switchTab('worksheet');
    });

    // worksheet
    $('#btnAddWorksheetLine')?.addEventListener('click', () => {
      const p = project();
      if (!p) return;
      p.worksheet = p.worksheet || [];
      p.worksheet.push(M.createWorksheetLine({ description: 'New line', quantity: 1 }));
      Store.touchProject(p);
      save();
      renderWorksheet();
      renderEstimate();
    });
    $('#btnDelWorksheetLine')?.addEventListener('click', () => {
      const p = project();
      if (!p || !selectedWorksheetLineId) return;
      p.worksheet = p.worksheet.filter((l) => l.id !== selectedWorksheetLineId);
      selectedWorksheetLineId = null;
      Store.touchProject(p);
      save();
      renderWorksheet();
      renderEstimate();
    });

    // budget
    $('#budgetTotal')?.addEventListener('change', () => {
      const p = project();
      if (!p) return;
      p.budget.totalBudget = Number($('#budgetTotal').value) || 0;
      Store.touchProject(p);
      save();
      renderBudget();
    });
    $('#budgetContingency')?.addEventListener('change', () => {
      const p = project();
      if (!p) return;
      p.budget.contingencyPct = Number($('#budgetContingency').value) || 0;
      Store.touchProject(p);
      save();
      renderBudget();
    });

    // notes
    $('#btnAddNote')?.addEventListener('click', () => {
      const p = project();
      if (!p) return;
      p.notes = p.notes || [];
      p.notes.unshift(M.createNote({ title: 'New note', body: '' }));
      Store.touchProject(p);
      save();
      renderNotes();
    });

    // export / import app state
    $('#menuExport').addEventListener('click', () => {
      downloadText('plan-takeoff-backup.json', Store.exportStateJson(state));
    });
    $('#menuImport').addEventListener('click', () => $('#fileJson').click());
    $('#fileJson').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      try {
        const text = await readFileAsText(f);
        state = Store.importStateJson(text);
        selectedProjectId = state.activeProjectId;
        Hist?.clear();
        await save(true);
        await bootstrapUi();
        alert('Import complete.');
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    });

    // optional tabs modal
    $('#menuTabs').addEventListener('click', () => {
      $$('[data-opt-tab]').forEach((cb) => {
        cb.checked = !!state.visibleOptionalTabs[cb.dataset.optTab];
      });
      openModal('modalTabs');
    });
    $$('[data-opt-tab]').forEach((cb) => {
      cb.addEventListener('change', () => {
        state.visibleOptionalTabs[cb.dataset.optTab] = cb.checked;
        save();
        applyTabVisibility();
      });
    });

    // modal close buttons
    $$('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    $$('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) {
          // Prefer closeModal so condition color preview is restored on Cancel/backdrop
          closeModal(bd.id);
        }
      });
    });

    // canvas
    planCanvas = new window.PlanCanvas($('#planCanvas'), {
      getContext: () => {
        const p = project();
        return {
          project: p,
          page: activePage(),
          condition: activeCondition(),
          layers: p?.layers || [],
          takeoffs: p?.takeoffs || [],
        };
      },
      onChange: onCanvasChange,
      onStatus: onCanvasStatus,
      onToolRequest: (tool) => {
        if (tool === 'room') openModal('modalRoom');
        else setTool(tool);
      },
    });

    Hist?.clear();
    await bootstrapUi();
  }

  async function bootstrapUi() {
    applyTabVisibility();
    renderProjects();
    updateHeader();
    // Default: Jobs library (disk folders). Open Jobs if already mid-takeoff.
    const est = window.PTEstimates;
    try {
      const online = est && typeof est.init === 'function' ? await est.init() : false;
      const preferred = online ? 'library' : project() ? 'takeoff' : 'library';
      const start =
        state.lastTab &&
        $(`.tab[data-tab="${state.lastTab}"]:not(.locked):not(.hidden-tab)`)
          ? state.lastTab
          : preferred;
      if (project() && ['takeoff', 'summary', 'estimate', 'projects'].includes(start)) {
        switchTab(start);
        if (start === 'takeoff') refreshTakeoff();
      } else {
        switchTab(preferred);
        if (preferred === 'library') scanLibrary();
      }
    } catch {
      switchTab('library');
    }
  }

  async function boot() {
    _openJobBusy = false;
    _openJobBusySince = 0;
    try {
      $('#statusDim').textContent = 'Loading…';
      // loadState migrates legacy fat localStorage → meta + IndexedDB, then drops the fat key
      let loaded = await Store.loadState();
      // Lean UI defaults (v2): hide advanced tabs until user re-enables
      if ((loaded.uiVersion || 1) < 2) {
        loaded.visibleOptionalTabs = {
          folders: false,
          cover: false,
          worksheet: false,
          budget: false,
          notes: false,
          resources: false,
        };
        loaded.uiVersion = 2;
        if (!loaded.lastTab || loaded.lastTab === 'projects') loaded.lastTab = 'library';
      }
      // Skip empty sample bid when user already has jobs from disk workflow
      if (!(loaded.projects && loaded.projects.some((p) => p.folderPath))) {
        loaded = Store.ensureSampleIfEmpty(loaded);
      }
      state = loaded;
      selectedProjectId = state.activeProjectId;
      await save(true);
    } catch (e) {
      console.error('Boot load failed', e);
      // If storage was full, try freeing the legacy blob then reload once
      try {
        Store.clearLegacyFatStorage?.();
      } catch {
        /* ignore */
      }
      state = Store.ensureSampleIfEmpty(Store.defaultAppState());
      selectedProjectId = state.activeProjectId;
    }
    await init();
  }

  document.addEventListener('DOMContentLoaded', () => {
    boot().catch((e) => {
      console.error(e);
      alert('PlanTakeoff failed to start: ' + (e.message || e));
    });
  });
})();

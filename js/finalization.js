/**
 * PlanTakeoff bid finalization and measuring baseline lock.
 * Persists the locked estimate and takeoff snapshot inside the active EST folder.
 */
(function () {
  'use strict';

  let appState = null;
  let diskJob = null;
  let activeFolder = '';
  let loadingFolder = '';
  let guardInstalled = false;
  let finalizing = false;

  const clone = (value) => {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  };

  const money = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  function captureStore() {
    const S = window.PTStore;
    if (!S || S.__finalizationCapture) return !!S;
    S.__finalizationCapture = true;

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
    if (!appState) return null;
    return (appState.projects || []).find((project) => project.id === appState.activeProjectId) || null;
  }

  function folderPath(project = currentProject()) {
    return String(project?.folderPath || '').trim();
  }

  function normalizeJob(job, project) {
    if (window.PTJobs?.normalizeJob) return window.PTJobs.normalizeJob(job || {}, {
      folder_path: folderPath(project),
      project_name: project?.name,
      folder_name: project?.name,
      modified: project?.updated,
    });
    return {
      ...(job || {}),
      path: job?.path || folderPath(project),
      status: job?.status || 'Estimating',
      notes: job?.notes || '',
      baselineEstimate: job?.baselineEstimate || null,
      actualBudget: job?.actualBudget || null,
      baselineLocked: !!job?.baselineLocked,
    };
  }

  function scannedJob(path) {
    const project = (window.PTEstimates?.lastScan?.projects || []).find((item) => item.folder_path === path);
    return project?.job || null;
  }

  function updateScanJob(path, job) {
    const project = (window.PTEstimates?.lastScan?.projects || []).find((item) => item.folder_path === path);
    if (project) project.job = clone(job);
  }

  async function loadDiskJob(project = currentProject(), force = false) {
    const path = folderPath(project);
    if (!path) {
      activeFolder = '';
      diskJob = null;
      applyLockUi();
      return null;
    }

    const fromScan = scannedJob(path);
    if (fromScan && (!diskJob || force || fromScan.updated !== diskJob.updated || fromScan.status !== diskJob.status)) {
      diskJob = normalizeJob(fromScan, project);
      activeFolder = path;
      applyLockUi();
      return diskJob;
    }

    if (!force && activeFolder === path && diskJob) return diskJob;
    if (loadingFolder === path) return diskJob;

    loadingFolder = path;
    try {
      const E = window.PTEstimates;
      if (!E || typeof E.getProject !== 'function') return diskJob;
      const result = await E.getProject(path);
      diskJob = normalizeJob(result?.job, project);
      activeFolder = path;
      updateScanJob(path, diskJob);
      return diskJob;
    } catch (error) {
      console.warn('Could not load disk job metadata', error);
      return diskJob;
    } finally {
      loadingFolder = '';
      applyLockUi();
    }
  }

  function isLocked() {
    const project = currentProject();
    if (diskJob?.baselineEstimate) {
      return diskJob.status !== 'Estimating' && diskJob.baselineLocked !== false;
    }
    const local = project?.takeoffBaseline;
    return !!local?.baselineEstimate && local.status !== 'Estimating' && local.locked !== false;
  }

  function installStyles() {
    if (document.getElementById('finalizationStyles')) return;
    const style = document.createElement('style');
    style.id = 'finalizationStyles';
    style.textContent = `
      #finalizeEstimateControls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #btnFinalizeBid{font-size:14px;font-weight:800;padding:10px 18px;box-shadow:0 2px 10px rgba(37,99,235,.25)}
      #btnReopenMeasuring{font-weight:700;padding:8px 12px}
      #takeoffBaselineBanner{margin:0 12px 8px;padding:10px 12px;border:1px solid #d97706;border-radius:8px;background:rgba(217,119,6,.12);display:flex;align-items:center;justify-content:space-between;gap:12px}
      #takeoffBaselineBanner strong{display:block}.baseline-detail{font-size:11px;color:var(--text-dim);margin-top:2px}
      body.pt-baseline-locked #planCanvas{cursor:not-allowed!important;filter:saturate(.75)}
    `;
    document.head.appendChild(style);
  }

  function installEstimateControls() {
    const toolbar = document.querySelector('#panel-estimate .toolbar');
    if (!toolbar || document.getElementById('finalizeEstimateControls')) return !!toolbar;
    const group = document.createElement('div');
    group.className = 'group';
    group.id = 'finalizeEstimateControls';
    group.innerHTML = `
      <button type="button" id="btnFinalizeBid" class="primary">Finalize &amp; Move to Bid Sent</button>
      <button type="button" id="btnReopenMeasuring" hidden>Re-open for measuring</button>
      <span class="chip" id="baselineEstimateStatus">Not finalized</span>`;
    toolbar.insertBefore(group, toolbar.firstChild);
    group.querySelector('#btnFinalizeBid').addEventListener('click', finalizeBid);
    group.querySelector('#btnReopenMeasuring').addEventListener('click', reopenMeasuring);
    return true;
  }

  function installTakeoffBanner() {
    const panel = document.getElementById('panel-takeoff');
    const hint = document.getElementById('takeoffHint');
    if (!panel || document.getElementById('takeoffBaselineBanner')) return !!panel;
    const banner = document.createElement('div');
    banner.id = 'takeoffBaselineBanner';
    banner.hidden = true;
    banner.innerHTML = `
      <div><strong>Baseline locked — measuring is read-only</strong><div class="baseline-detail" id="takeoffBaselineDetail">Finalize data is stored in this EST folder.</div></div>
      <button type="button" id="btnReopenFromTakeoff">Re-open for measuring</button>`;
    (hint?.parentNode || panel).insertBefore(banner, hint ? hint.nextSibling : panel.firstChild);
    banner.querySelector('button').addEventListener('click', reopenMeasuring);
    return true;
  }

  function installApi() {
    const E = window.PTEstimates;
    if (!E || E.__finalizationApi) return !!E;
    E.__finalizationApi = true;
    E.finalizeJob = async function finalizeJob(path, baselineEstimate, takeoffSnapshot) {
      const response = await fetch('/api/job/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, baselineEstimate, takeoffSnapshot }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || response.statusText || 'Could not finalize bid');
      return data;
    };
    return true;
  }

  function disableForLock(element, locked) {
    if (!element || !('disabled' in element)) return;
    if (locked) {
      if (!element.disabled) {
        element.dataset.baselineDisabled = '1';
        element.disabled = true;
      }
    } else if (element.dataset.baselineDisabled === '1') {
      element.disabled = false;
      delete element.dataset.baselineDisabled;
    }
  }

  function applyLockUi() {
    const project = currentProject();
    const path = folderPath(project);
    const locked = !!path && isLocked();
    document.body.classList.toggle('pt-baseline-locked', locked);

    const finalize = document.getElementById('btnFinalizeBid');
    const reopen = document.getElementById('btnReopenMeasuring');
    const status = document.getElementById('baselineEstimateStatus');
    const banner = document.getElementById('takeoffBaselineBanner');
    const detail = document.getElementById('takeoffBaselineDetail');
    const finalizedAt = diskJob?.baselineEstimate?.finalizedAt || diskJob?.baselineFinalizedAt || project?.takeoffBaseline?.finalizedAt;

    if (finalize) {
      finalize.hidden = locked;
      finalize.disabled = !path || finalizing;
      finalize.title = path ? 'Lock current estimate and save a takeoff snapshot to the EST folder' : 'Open a disk-backed EST job first';
    }
    if (reopen) reopen.hidden = !locked;
    if (status) {
      if (!path) status.textContent = 'Open an EST job to finalize';
      else if (locked) status.textContent = `Locked · ${diskJob?.status || 'Bid Sent'}`;
      else if (diskJob?.baselineEstimate) status.textContent = 'Re-opened · next finalize overwrites baseline';
      else status.textContent = 'Not finalized';
    }
    if (banner) banner.hidden = !locked;
    if (detail && locked) {
      const when = finalizedAt ? new Date(finalizedAt).toLocaleString('en-US') : 'saved baseline';
      detail.textContent = `${diskJob?.status || 'Bid Sent'} · finalized ${when}. Use Re-open for measuring to make changes.`;
    }

    const selectors = [
      '#takeoffToolbar button:not(#btnFitView)',
      '#takeoffToolbar select',
      '#btnAddLinear', '#btnAddArea', '#btnAddCount', '#btnEditCond', '#btnLoadSuite',
      '#btnDeleteTakeoff', '#btnMarkInsert', '#btnMarkAppend', '#btnMarkDelVertex', '#btnMarkToArea', '#btnMarkRoomPack',
      '#markReassignCond', '#markMultiplier', '#conditionCoverageRate', '#markWastePct',
      '#paintingProductivityControls button', '#paintingProductivityControls input',
    ];
    document.querySelectorAll(selectors.join(',')).forEach((element) => disableForLock(element, locked));
  }

  function installGuards() {
    if (guardInstalled) return;
    const canvas = document.getElementById('planCanvas');
    if (!canvas) return;
    guardInstalled = true;

    const blockCanvas = (event) => {
      if (!isLocked()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const banner = document.getElementById('takeoffBaselineBanner');
      banner?.scrollIntoView?.({ block: 'nearest' });
    };
    ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu'].forEach((name) => {
      canvas.addEventListener(name, blockCanvas, true);
    });

    window.addEventListener('keydown', (event) => {
      if (!isLocked() || !document.getElementById('panel-takeoff')?.classList.contains('active')) return;
      const target = event.target;
      if (target && (target.matches?.('input,textarea,select') || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      const modifying = ['l', 'a', 'c', 'r', 'm', 'delete', 'backspace', 'enter'].includes(key) ||
        ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(key));
      if (modifying) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function estimateBaseline(project) {
    const estimate = window.PTModels.buildFullEstimate(project, { hideZero: false });
    const takeoffLines = clone(estimate.takeoffLines || []);
    const gearLines = clone(estimate.gearLines || []);
    const totals = clone(estimate.totals || {});
    const gallonTotal = takeoffLines.reduce((sum, line) => sum + (Number(line.gallons) || 0), 0);
    return {
      version: 1,
      projectId: project.id,
      projectName: project.name,
      jobNumber: project.jobNumber || '',
      quantities: takeoffLines.map((line) => ({
        conditionId: line.conditionId || null,
        condition: line.name || '',
        qty: Number(line.qty) || 0,
        unit: line.unit || '',
        gallons: Number(line.gallons) || 0,
        material: Number(line.material) || 0,
        labor: Number(line.labor) || 0,
        sub: Number(line.sub) || 0,
        total: Number(line.total) || 0,
      })),
      takeoffLines,
      gearLines,
      totals,
      gallonTotal,
      estimatedTotal: Number(totals.grand) || 0,
    };
  }

  function takeoffSnapshot(project, baseline) {
    return {
      version: 1,
      project: {
        id: project.id,
        name: project.name,
        jobNumber: project.jobNumber || '',
        folderPath: folderPath(project),
        activePageId: project.activePageId || null,
        activeConditionId: project.activeConditionId || null,
        pages: (project.pages || []).map((page) => ({
          id: page.id,
          name: page.name,
          pageNumber: page.pageNumber,
          sourcePath: page.sourcePath || '',
          pdfPage: page.pdfPage ?? null,
          imageWidth: page.imageWidth || 0,
          imageHeight: page.imageHeight || 0,
          scaleId: page.scaleId || '',
          scaleSource: page.scaleSource || '',
          feetPerPixel: Number(page.feetPerPixel) || 0,
          calibrated: !!page.calibrated,
          dpi: Number(page.dpi) || 0,
          renderDpi: Number(page.renderDpi) || 0,
          pixelScale: Number(page.pixelScale) || 1,
        })),
        layers: clone(project.layers || []),
        conditions: clone(project.conditions || []),
        takeoffs: clone(project.takeoffs || []),
        worksheet: clone(project.worksheet || []),
        paintingSettings: clone(project.paintingSettings || {}),
        assemblies: clone(project.assemblies || []),
      },
      baselineEstimate: clone(baseline),
    };
  }

  async function persistLocal(project) {
    if (!window.PTStore || !appState) return;
    window.PTStore.touchProject?.(project);
    await window.PTStore.saveState(appState);
  }

  async function finalizeBid() {
    if (finalizing) return;
    const project = currentProject();
    const path = folderPath(project);
    if (!project || !path) {
      alert('Open a job from the Estimates Library or Command Center before finalizing.');
      return;
    }
    if (diskJob?.baselineEstimate) {
      const overwrite = confirm('This job already has a baseline estimate. Finalizing again will overwrite the baseline and create a new timestamped takeoff snapshot. Continue?');
      if (!overwrite) return;
    }

    finalizing = true;
    applyLockUi();
    try {
      await persistLocal(project);
      const baseline = estimateBaseline(project);
      const snapshot = takeoffSnapshot(project, baseline);
      const result = await window.PTEstimates.finalizeJob(path, baseline, snapshot);
      diskJob = normalizeJob(result.job, project);
      activeFolder = path;
      updateScanJob(path, diskJob);
      project.takeoffBaseline = {
        locked: true,
        status: 'Bid Sent',
        finalizedAt: result.finalizedAt,
        baselineEstimate: clone(diskJob.baselineEstimate),
        snapshot: result.snapshot,
      };
      await persistLocal(project);
      applyLockUi();
      window.dispatchEvent(new CustomEvent('pt:job-finalized', { detail: { path, job: clone(diskJob) } }));
      alert(`Bid finalized at ${money.format(Number(diskJob.estimatedTotal) || 0)}.\n\nStatus: Bid Sent\nBaseline and takeoff snapshot were saved inside the EST folder.`);
      document.getElementById('commandCenterTab')?.click();
      setTimeout(() => document.getElementById('commandCenterRefresh')?.click(), 100);
    } catch (error) {
      console.error(error);
      alert(`Finalize failed: ${error.message || error}`);
    } finally {
      finalizing = false;
      applyLockUi();
    }
  }

  async function reopenMeasuring() {
    const project = currentProject();
    const path = folderPath(project);
    if (!project || !path) return;
    const proceed = confirm(
      'Re-open this job for measuring?\n\n' +
      'The saved baseline remains on disk, but the next “Finalize & Move to Bid Sent” will overwrite it with the revised quantities and totals.'
    );
    if (!proceed) return;

    try {
      const saved = await window.PTEstimates.updateJob(path, { status: 'Estimating' });
      diskJob = normalizeJob(saved, project);
      activeFolder = path;
      updateScanJob(path, diskJob);
      project.takeoffBaseline = {
        ...(project.takeoffBaseline || {}),
        locked: false,
        status: 'Estimating',
        reopenedAt: new Date().toISOString().slice(0, 19),
        baselineEstimate: clone(diskJob.baselineEstimate),
      };
      await persistLocal(project);
      applyLockUi();
      window.dispatchEvent(new CustomEvent('pt:job-reopened', { detail: { path, job: clone(diskJob) } }));
      alert('Job re-opened for measuring. Status is now Estimating.');
    } catch (error) {
      alert(`Could not re-open measuring: ${error.message || error}`);
    }
  }

  function installAll() {
    captureStore();
    installStyles();
    installApi();
    installEstimateControls();
    installTakeoffBanner();
    installGuards();
    applyLockUi();
  }

  window.PTFinalize = {
    finalizeBid,
    reopenMeasuring,
    isLocked,
    getDiskJob: () => clone(diskJob),
  };

  captureStore();
  document.addEventListener('DOMContentLoaded', () => {
    installAll();
    document.querySelectorAll('#tabBar button').forEach((button) => {
      button.addEventListener('click', () => setTimeout(() => loadDiskJob(currentProject()), 0));
    });

    let ticks = 0;
    const timer = setInterval(() => {
      installAll();
      const project = currentProject();
      const path = folderPath(project);
      if (path !== activeFolder) {
        diskJob = null;
        activeFolder = path;
        loadDiskJob(project, true);
      } else {
        const fresh = scannedJob(path);
        if (fresh && (!diskJob || fresh.updated !== diskJob.updated || fresh.status !== diskJob.status)) {
          diskJob = normalizeJob(fresh, project);
        }
        applyLockUi();
      }
      ticks += 1;
      if (ticks > 240 && !currentProject()) clearInterval(timer);
    }, 500);
  });
})();

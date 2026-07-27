/**
 * PlanTakeoff release hardening: global error boundaries, disk takeoff sync,
 * updated timestamp consistency, and close-event backups.
 */
(function () {
  'use strict';

  let appState = null;
  let lastActiveId = null;
  let lastActiveProject = null;
  let lastSignatureByPath = new Map();
  let touchTimer = null;
  let touchBusy = false;
  let touchQueued = null;
  let installed = false;
  let estimatesInstalled = false;
  let lastErrorKey = '';
  let lastErrorAt = 0;
  let closeBackupSent = false;

  function clone(value) {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  }

  function toast(message, options = {}) {
    if (window.PTToast) return window.PTToast(message, options);
    console.error(options.title || 'PlanTakeoff', message);
    return null;
  }

  function friendlyError(error, source) {
    const message = String(error?.message || error?.reason?.message || error?.reason || error || 'Unknown interface error');
    const key = `${source}:${message}`;
    const now = Date.now();
    if (key === lastErrorKey && now - lastErrorAt < 2500) return;
    lastErrorKey = key;
    lastErrorAt = now;
    toast(
      `Your saved project data was not removed. ${message}`,
      { type: 'error', title: `PlanTakeoff recovered from ${source}`, timeout: 10000 }
    );
  }

  function installErrorBoundary() {
    if (window.__ptGlobalErrorBoundary) return;
    window.__ptGlobalErrorBoundary = true;
    window.addEventListener('error', (event) => {
      console.error('PlanTakeoff uncaught error', event.error || event.message);
      friendlyError(event.error || event.message, 'an interface error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error('PlanTakeoff unhandled promise rejection', event.reason);
      friendlyError(event.reason, 'an unfinished operation');
    });
  }

  function compactProject(project) {
    if (!project) return null;
    const data = clone(project);
    delete data.updatedAt;
    for (const page of data.pages || []) {
      if (page.imageDataUrl) {
        page.hasImage = true;
        delete page.imageDataUrl;
      }
    }
    return data;
  }

  function projectPath(project) {
    return String(project?.folderPath || '').trim();
  }

  function signature(project) {
    const compact = compactProject(project);
    return compact ? JSON.stringify(compact) : '';
  }

  function updateScanJob(path, job) {
    const scanned = (window.PTEstimates?.lastScan?.projects || []).find((project) => project.folder_path === path);
    if (scanned && job) scanned.job = clone(job);
  }

  async function postJson(url, body, options = {}) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.detail || data.error || response.statusText || 'Local server request failed');
    return data;
  }

  async function syncTakeoff(project, touchTimestamp) {
    const path = projectPath(project);
    if (!path) return null;
    const data = await postJson('/api/job/touch', {
      path,
      takeoffData: compactProject(project),
      touchTimestamp,
    });
    updateScanJob(path, data.job);
    window.dispatchEvent(new CustomEvent('pt:job-touched', { detail: { path, job: clone(data.job), touchTimestamp } }));
    return data;
  }

  function queueTouch(project) {
    const path = projectPath(project);
    if (!path) return;
    const nextSignature = signature(project);
    if (!nextSignature || lastSignatureByPath.get(path) === nextSignature) return;
    lastSignatureByPath.set(path, nextSignature);
    touchQueued = clone(project);
    if (touchTimer) clearTimeout(touchTimer);
    touchTimer = setTimeout(flushTouch, 650);
  }

  async function flushTouch() {
    touchTimer = null;
    if (touchBusy || !touchQueued) return;
    const project = touchQueued;
    touchQueued = null;
    touchBusy = true;
    try {
      await syncTakeoff(project, true);
    } catch (error) {
      toast(error.message || String(error), { type: 'error', title: 'Takeoff disk sync failed', timeout: 9000 });
    } finally {
      touchBusy = false;
      if (touchQueued) touchTimer = setTimeout(flushTouch, 250);
    }
  }

  async function initialSync(project) {
    const path = projectPath(project);
    if (!path) return;
    const sig = signature(project);
    if (sig) lastSignatureByPath.set(path, sig);
    try {
      await syncTakeoff(project, false);
    } catch (error) {
      console.warn('Initial takeoff working snapshot failed', error);
    }
  }

  async function createBackup(project, reason = 'job-closed', silent = false) {
    const path = projectPath(project);
    if (!path) return null;
    try {
      const data = await postJson('/api/backup/create', { path, reason, takeoffData: compactProject(project) });
      if (!silent) toast(`Backup created in ${data.backupFolder}`, { type: 'success', title: 'Job backup' });
      window.dispatchEvent(new CustomEvent('pt:job-backed-up', { detail: { path, reason, backup: data.backupFolder } }));
      return data;
    } catch (error) {
      if (!silent) toast(error.message || String(error), { type: 'error', title: 'Backup failed', timeout: 9000 });
      else console.warn('Job close backup failed', error);
      return null;
    }
  }

  function findProject(state, id) {
    return (state?.projects || []).find((project) => project.id === id) || null;
  }

  function captureState(nextState, options = {}) {
    if (!nextState) return;
    const nextId = nextState.activeProjectId || null;
    if (lastActiveId && nextId !== lastActiveId && lastActiveProject) {
      createBackup(lastActiveProject, 'job-closed', true);
    }
    appState = nextState;
    lastActiveId = nextId;
    lastActiveProject = nextId ? clone(findProject(nextState, nextId)) : null;
    if (nextId && options.initial) initialSync(findProject(nextState, nextId));
  }

  function installStoreBoundary() {
    const S = window.PTStore;
    if (!S || installed) return !!S;
    installed = true;

    if (typeof S.defaultAppState === 'function') {
      const original = S.defaultAppState;
      S.defaultAppState = function (...args) {
        const state = original.apply(this, args);
        captureState(state, { initial: true });
        return state;
      };
    }
    if (typeof S.loadState === 'function') {
      const original = S.loadState;
      S.loadState = async function (...args) {
        const state = await original.apply(this, args);
        captureState(state, { initial: true });
        return state;
      };
    }
    if (typeof S.saveState === 'function') {
      const original = S.saveState;
      S.saveState = async function (state, ...args) {
        const result = await original.call(this, state, ...args);
        captureState(state);
        const current = findProject(state, state?.activeProjectId);
        if (current) queueTouch(current);
        return result;
      };
    }
    return true;
  }

  function installEstimateBoundary() {
    const E = window.PTEstimates;
    if (!E || estimatesInstalled || typeof E.updateJob !== 'function') return !!E;
    estimatesInstalled = true;
    const originalUpdateJob = E.updateJob;
    E.updateJob = async function updateJobWithFreshTakeoff(path, updates = {}) {
      if (updates.status) {
        const current = findProject(appState, appState?.activeProjectId);
        if (current && projectPath(current) === path) await syncTakeoff(current, true);
      }
      return originalUpdateJob.call(this, path, updates);
    };
    return true;
  }

  function pageCloseBackup() {
    if (closeBackupSent) return;
    closeBackupSent = true;
    const project = lastActiveProject || findProject(appState, appState?.activeProjectId);
    const path = projectPath(project);
    if (!path) return;
    const basic = { path, reason: 'application-closed' };
    const withTakeoff = { ...basic, takeoffData: compactProject(project) };
    const fullBody = JSON.stringify(withTakeoff);
    const body = fullBody.length <= 55000 ? fullBody : JSON.stringify(basic);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/backup/create', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/backup/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
        }).catch(() => {});
      }
    } catch (_) { /* closing */ }
  }

  function installLifecycleHooks() {
    if (window.__ptLifecycleHooks) return;
    window.__ptLifecycleHooks = true;
    window.addEventListener('pagehide', pageCloseBackup);
    window.addEventListener('beforeunload', pageCloseBackup);
    window.addEventListener('pt:job-finalized', () => {
      const project = findProject(appState, appState?.activeProjectId);
      if (project) queueTouch(project);
    });
    window.addEventListener('pt:change-order-geometry-restored', () => {
      const project = findProject(appState, appState?.activeProjectId);
      if (project) queueTouch(project);
    });
  }

  window.PTSuite = {
    backupCurrent: (reason = 'manual') => createBackup(findProject(appState, appState?.activeProjectId), reason),
    syncCurrent: () => syncTakeoff(findProject(appState, appState?.activeProjectId), true),
    getState: () => clone(appState),
  };

  installErrorBoundary();
  installLifecycleHooks();
  installStoreBoundary();
  installEstimateBoundary();
  document.addEventListener('DOMContentLoaded', () => {
    installErrorBoundary();
    installLifecycleHooks();
    installStoreBoundary();
    installEstimateBoundary();
    let tries = 0;
    const timer = setInterval(() => {
      installStoreBoundary();
      installEstimateBoundary();
      tries += 1;
      if ((installed && estimatesInstalled) || tries > 100) clearInterval(timer);
    }, 100);
  });
})();

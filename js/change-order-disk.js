/**
 * Disk geometry bridge for approved change orders.
 * Stores generated visual takeoff objects in change-orders.json and restores
 * missing objects when an EST job is reopened.
 */
(function () {
  'use strict';

  let appState = null;
  let installed = false;

  const clone = (value) => {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  };

  function captureStore() {
    const S = window.PTStore;
    if (!S || S.__changeOrderDiskCapture) return !!S;
    S.__changeOrderDiskCapture = true;

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

  function projectForPath(path) {
    return (appState?.projects || []).find((project) => project.folderPath === path) || null;
  }

  function attachGeneratedGeometry(path, changeOrders) {
    const project = projectForPath(path);
    if (!project) return changeOrders;
    const byId = new Map((project.takeoffs || []).map((takeoff) => [takeoff.id, takeoff]));
    return (changeOrders || []).map((order) => ({
      ...order,
      items: (order.items || []).map((item) => {
        const ids = Array.isArray(item.generatedTakeoffIds) ? item.generatedTakeoffIds : [];
        if (!ids.length) return item;
        const objects = ids.map((id) => byId.get(id)).filter(Boolean).map(clone);
        return objects.length ? { ...item, generatedTakeoffObjects: objects } : item;
      }),
    }));
  }

  async function restoreGeneratedGeometry(path, result) {
    const project = projectForPath(path);
    if (!project || !Array.isArray(result?.change_orders)) return result;
    project.takeoffs ||= [];
    const existing = new Set(project.takeoffs.map((takeoff) => takeoff.id));
    let restored = 0;

    for (const order of result.change_orders) {
      if (order.status !== 'Approved') continue;
      for (const item of order.items || []) {
        for (const stored of item.generatedTakeoffObjects || []) {
          if (!stored?.id || existing.has(stored.id)) continue;
          const takeoff = {
            ...clone(stored),
            changeOrderId: order.id,
            changeOrderItemId: item.id,
            isChangeOrder: true,
            excludeFromBaseEstimate: true,
          };
          if (takeoff.isDeduct && !takeoff.isDeduction) takeoff.isDeduction = true;
          project.takeoffs.push(takeoff);
          existing.add(takeoff.id);
          restored += 1;
        }
      }
    }

    if (restored && window.PTStore && appState) {
      window.PTStore.touchProject?.(project);
      await window.PTStore.saveState(appState);
      window.dispatchEvent(new CustomEvent('pt:change-order-geometry-restored', {
        detail: { path, restored },
      }));
    }
    return result;
  }

  function installBridge() {
    const E = window.PTEstimates;
    if (!E || installed || typeof E.saveChangeOrders !== 'function' || typeof E.getProject !== 'function') {
      return false;
    }
    installed = true;

    const originalSave = E.saveChangeOrders;
    E.saveChangeOrders = function saveChangeOrdersWithGeometry(path, changeOrders) {
      return originalSave.call(this, path, attachGeneratedGeometry(path, changeOrders));
    };

    const originalGetProject = E.getProject;
    E.getProject = async function getProjectWithChangeOrderGeometry(path) {
      const result = await originalGetProject.call(this, path);
      return restoreGeneratedGeometry(path, result);
    };
    return true;
  }

  captureStore();
  document.addEventListener('DOMContentLoaded', () => {
    captureStore();
    installBridge();
    let tries = 0;
    const timer = setInterval(() => {
      captureStore();
      installBridge();
      tries += 1;
      if (installed || tries >= 100) clearInterval(timer);
    }, 100);
  });
})();

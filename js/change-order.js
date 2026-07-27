/**
 * PlanTakeoff disk-backed change-order workflow.
 * Keeps approved scope linked to original takeoff geometry and persists
 * change-orders.json inside the active EST folder.
 */
(function () {
  'use strict';

  const STATUSES = ['Pending', 'Approved', 'Rejected'];
  const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  let appState = null;
  let activeFolder = '';
  let orders = [];
  let diskJob = null;
  let loading = false;
  let draftItems = [];
  let commandObserver = null;

  const clone = (value) => {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  };
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const uid = () => window.PTModels?.uid?.() ||
    (crypto.randomUUID ? crypto.randomUUID() : `co_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value) => MONEY.format(number(value));

  function captureStore() {
    const S = window.PTStore;
    if (!S || S.__changeOrderCapture) return !!S;
    S.__changeOrderCapture = true;

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

  async function persistProject(project) {
    if (!project || !appState || !window.PTStore) return;
    window.PTStore.touchProject?.(project);
    await window.PTStore.saveState(appState);
  }

  function installModelExtension() {
    const M = window.PTModels;
    if (!M || M.__changeOrderBaseEstimate) return !!M;
    M.__changeOrderBaseEstimate = true;
    const originalBuild = M.buildFullEstimate;
    M.buildFullEstimate = function buildBaseEstimateWithoutApprovedCoGeometry(project, opts = {}) {
      if (!project?.takeoffs?.some((takeoff) => takeoff.excludeFromBaseEstimate)) {
        return originalBuild.call(this, project, opts);
      }
      const baseProject = {
        ...project,
        takeoffs: project.takeoffs.filter((takeoff) => !takeoff.excludeFromBaseEstimate),
      };
      return originalBuild.call(this, baseProject, opts);
    };
    return true;
  }

  function installHistoryExtension() {
    const H = window.PTHistory;
    if (!H || H.recordChangeOrder) return !!H;
    const audit = [];
    H.recordChangeOrder = function recordChangeOrder(changeOrder, createdObjects = []) {
      audit.unshift({
        id: changeOrder?.id || uid(),
        date: changeOrder?.date || new Date().toISOString().slice(0, 10),
        description: changeOrder?.description || 'Change Order',
        status: changeOrder?.status || 'Approved',
        totalImpact: number(changeOrder?.totalImpact),
        takeoffIds: createdObjects.map((object) => object.id),
        recordedAt: new Date().toISOString(),
      });
      if (audit.length > (H.CAP || 80)) audit.length = H.CAP || 80;
    };
    H.getChangeOrderHistory = () => clone(audit);
    return true;
  }

  function installApi() {
    const E = window.PTEstimates;
    if (!E || E.__changeOrderApi) return !!E;
    E.__changeOrderApi = true;
    E.saveChangeOrders = async function saveChangeOrders(path, changeOrders) {
      const response = await fetch('/api/change-orders/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, changeOrders }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || response.statusText || 'Could not save change orders');
      return data;
    };
    return true;
  }

  function installStyles() {
    if (document.getElementById('changeOrderStyles')) return;
    const style = document.createElement('style');
    style.id = 'changeOrderStyles';
    style.textContent = `
      #panel-change-orders{padding:14px;overflow:auto;background:var(--bg)}
      .co-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
      .co-head h2{margin:0;font-size:20px}.co-head p{margin:3px 0 0;color:var(--text-dim);font-size:12px}
      .co-summary{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin-bottom:14px}
      .co-summary-card{border:1px solid var(--border);background:var(--bg-panel);border-radius:9px;padding:12px}
      .co-summary-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);font-weight:800}
      .co-summary-value{font-size:21px;font-weight:800;margin-top:4px}
      .co-layout{display:grid;grid-template-columns:minmax(390px,1.1fr) minmax(390px,.9fr);gap:14px;align-items:start}
      .co-pane{border:1px solid var(--border);background:var(--bg-panel);border-radius:10px;overflow:hidden}
      .co-pane-head{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;border-bottom:1px solid var(--border);font-weight:800}
      .co-list{padding:10px;display:flex;flex-direction:column;gap:9px;max-height:calc(100vh - 330px);overflow:auto}
      .co-card{border:1px solid var(--border);border-left:4px solid #64748b;border-radius:8px;background:var(--bg-input);padding:10px}
      .co-card[data-status="Pending"]{border-left-color:#dc2626}.co-card[data-status="Approved"]{border-left-color:#16a34a}.co-card[data-status="Rejected"]{border-left-color:#64748b;opacity:.8}
      .co-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .co-card-title{font-weight:800}.co-card-date{color:var(--text-dim);font-size:11px;margin-top:2px}
      .co-status{display:inline-flex;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:800}
      .co-status.Pending{background:#fee2e2;color:#b91c1c}.co-status.Approved{background:#dcfce7;color:#166534}.co-status.Rejected{background:#e2e8f0;color:#475569}
      .co-impact{font-weight:800;margin-top:8px}.co-items{margin-top:8px;border-top:1px solid var(--border);padding-top:7px;display:flex;flex-direction:column;gap:4px}
      .co-item-line{display:grid;grid-template-columns:1fr auto;gap:8px;font-size:11px}.co-item-line span:last-child{font-weight:700}
      .co-actions{display:flex;gap:6px;margin-top:9px}.co-actions button{font-size:11px;padding:6px 9px}
      .co-form{padding:12px}.co-form-grid{display:grid;grid-template-columns:150px 1fr;gap:9px}.co-form-grid .full{grid-column:1/-1}
      .co-form label{font-size:11px;color:var(--text-dim);font-weight:700;display:block;margin-bottom:4px}
      .co-builder{border:1px solid var(--border);border-radius:8px;margin-top:12px;overflow:hidden}
      .co-builder-head{display:flex;align-items:center;justify-content:space-between;padding:8px 9px;background:var(--bg-input);border-bottom:1px solid var(--border);font-weight:800;font-size:11px}
      .co-item-editor{display:grid;grid-template-columns:110px minmax(145px,1fr) 90px 80px 90px auto;gap:6px;padding:9px;align-items:end}
      .co-item-editor .linked-only,.co-item-editor .manual-only{min-width:0}
      .co-draft-list{padding:8px;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border)}
      .co-draft-row{display:grid;grid-template-columns:1fr 85px auto;gap:8px;align-items:center;font-size:11px;padding:6px;background:var(--bg-input);border-radius:6px}
      .co-form-total{display:flex;align-items:center;justify-content:space-between;margin-top:10px;font-weight:800}
      .co-pending-badge{display:inline-flex;align-items:center;margin-left:6px;border-radius:999px;padding:2px 7px;background:#dc2626;color:#fff;font-size:9px;font-weight:900;vertical-align:middle}
      #changeOrdersTabBadge{margin-left:5px}
      @media(max-width:980px){.co-layout{grid-template-columns:1fr}.co-summary{grid-template-columns:repeat(2,1fr)}.co-item-editor{grid-template-columns:1fr 1fr 1fr}.co-item-editor button{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function installTab() {
    if (document.querySelector('[data-tab="change-orders"]')) return true;
    const tabBar = document.getElementById('tabBar');
    const panels = document.querySelector('.tab-panels');
    if (!tabBar || !panels) return false;

    const estimateTab = tabBar.querySelector('[data-tab="estimate"]');
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab locked';
    tab.dataset.tab = 'change-orders';
    tab.innerHTML = `Change Orders <span id="changeOrdersTabBadge"></span>`;
    tab.title = 'Job change orders linked to takeoff quantities';
    if (estimateTab?.nextSibling) tabBar.insertBefore(tab, estimateTab.nextSibling);
    else tabBar.appendChild(tab);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.id = 'panel-change-orders';
    panel.innerHTML = `
      <div class="co-head">
        <div><h2>Change Orders</h2><p>Approved items update the disk-backed job total and linked plan quantities.</p></div>
        <button type="button" id="btnRefreshChangeOrders">Refresh</button>
      </div>
      <div class="co-summary" id="changeOrderSummary"></div>
      <div class="co-layout">
        <section class="co-pane">
          <div class="co-pane-head"><span>Change Order List</span><span id="changeOrderCount">0</span></div>
          <div class="co-list" id="changeOrderList"></div>
        </section>
        <section class="co-pane">
          <div class="co-pane-head"><span>Create New Change Order</span><span>Pending</span></div>
          <form class="co-form" id="changeOrderForm">
            <div class="co-form-grid">
              <div><label for="coDate">Date</label><input type="date" id="coDate" required /></div>
              <div><label for="coDescription">Description</label><input type="text" id="coDescription" placeholder="Describe the requested change" required /></div>
            </div>
            <div class="co-builder">
              <div class="co-builder-head"><span>Items</span><span>Linked takeoff or manual line</span></div>
              <div class="co-item-editor">
                <div><label for="coItemType">Type</label><select id="coItemType"><option value="linked">Linked Takeoff</option><option value="manual">Manual Line</option></select></div>
                <div class="linked-only"><label for="coLinkedTakeoff">Takeoff object</label><select id="coLinkedTakeoff"></select></div>
                <div class="manual-only" hidden><label for="coManualDescription">Line description</label><input type="text" id="coManualDescription" /></div>
                <div><label for="coItemQty">Qty / Delta</label><input type="number" id="coItemQty" step="0.01" /></div>
                <div><label for="coItemUnit">Unit</label><input type="text" id="coItemUnit" placeholder="SF" /></div>
                <div><label for="coItemUnitCost">Unit cost</label><input type="number" id="coItemUnitCost" min="0" step="0.01" /></div>
                <button type="button" id="btnAddChangeOrderItem">Add Item</button>
              </div>
              <div class="co-draft-list" id="changeOrderDraftItems"></div>
            </div>
            <div class="co-form-total"><span>Pending impact</span><span id="changeOrderDraftTotal">$0.00</span></div>
            <button type="submit" class="primary" style="width:100%;margin-top:10px;padding:10px;font-weight:800">Create New Change Order</button>
          </form>
        </section>
      </div>`;
    const estimatePanel = document.getElementById('panel-estimate');
    if (estimatePanel?.nextSibling) panels.insertBefore(panel, estimatePanel.nextSibling);
    else panels.appendChild(panel);

    tab.addEventListener('click', () => setTimeout(() => loadOrders(true), 0));
    panel.querySelector('#btnRefreshChangeOrders').addEventListener('click', () => loadOrders(true));
    panel.querySelector('#coItemType').addEventListener('change', updateItemEditor);
    panel.querySelector('#coLinkedTakeoff').addEventListener('change', prefillLinkedItem);
    panel.querySelector('#btnAddChangeOrderItem').addEventListener('click', addDraftItem);
    panel.querySelector('#changeOrderForm').addEventListener('submit', createChangeOrder);
    panel.querySelector('#coDate').value = new Date().toISOString().slice(0, 10);
    renderDraftItems();
    return true;
  }

  function activeOriginalTakeoffs(project = currentProject()) {
    return (project?.takeoffs || []).filter((takeoff) =>
      !takeoff.changeOrderId && !takeoff.isChangeOrder
    );
  }

  function objectQuantity(project, takeoff) {
    const condition = (project?.conditions || []).find((item) => item.id === takeoff.conditionId);
    const page = (project?.pages || []).find((item) => item.id === takeoff.pageId);
    if (!condition || !page) return { qty: 0, unit: '', condition, page };
    const clean = { ...takeoff, isDeduction: false, isDeduct: false, parentId: null };
    const q = window.PTModels.computeObjectQuantity(clean, condition, page);
    const useSurface = condition.estimateQtyMode === 'surface' && number(q.secondary) !== 0;
    return {
      qty: useSurface ? number(q.secondary) : number(q.primary),
      unit: useSurface ? (condition.unitSecondary || 'SF') : (condition.unitPrimary || ''),
      primaryQty: number(q.primary),
      secondaryQty: number(q.secondary),
      condition,
      page,
    };
  }

  function conditionUnitCost(project, conditionId) {
    try {
      const full = window.PTModels.buildFullEstimate(project, { hideZero: false });
      const lines = (full.takeoffLines || []).filter((line) => line.conditionId === conditionId);
      const qty = lines.reduce((sum, line) => sum + Math.abs(number(line.qty)), 0);
      const total = lines.reduce((sum, line) => sum + number(line.total), 0);
      if (qty > 0) return total / qty;
    } catch (_) {
      /* fall through */
    }
    const condition = (project?.conditions || []).find((item) => item.id === conditionId);
    return number(condition?.materialUnitCost) + number(condition?.laborUnitCost) + number(condition?.subUnitCost);
  }

  function takeoffOptionLabel(project, takeoff) {
    const info = objectQuantity(project, takeoff);
    const conditionName = info.condition?.name || 'Condition';
    const pageName = info.page?.name || 'Page';
    return `${conditionName} · ${pageName} · ${window.PTModels.formatQty(info.qty, 2)} ${info.unit}`;
  }

  function fillTakeoffSelect() {
    const select = document.getElementById('coLinkedTakeoff');
    const project = currentProject();
    if (!select) return;
    const list = activeOriginalTakeoffs(project);
    select.innerHTML = list.length
      ? list.map((takeoff) => `<option value="${esc(takeoff.id)}">${esc(takeoffOptionLabel(project, takeoff))}</option>`).join('')
      : '<option value="">No measured takeoffs available</option>';
    select.disabled = !list.length;
    prefillLinkedItem();
  }

  function updateItemEditor() {
    const linked = document.getElementById('coItemType')?.value === 'linked';
    document.querySelectorAll('#panel-change-orders .linked-only').forEach((element) => { element.hidden = !linked; });
    document.querySelectorAll('#panel-change-orders .manual-only').forEach((element) => { element.hidden = linked; });
    if (linked) prefillLinkedItem();
    else {
      document.getElementById('coItemQty').value = '1';
      document.getElementById('coItemUnit').value = 'LS';
      document.getElementById('coItemUnitCost').value = '';
    }
  }

  function prefillLinkedItem() {
    const project = currentProject();
    const id = document.getElementById('coLinkedTakeoff')?.value;
    const takeoff = (project?.takeoffs || []).find((item) => item.id === id);
    if (!takeoff) return;
    const info = objectQuantity(project, takeoff);
    document.getElementById('coItemQty').value = '';
    document.getElementById('coItemQty').placeholder = `e.g. ${window.PTModels.formatQty(info.qty, 2)} or -${window.PTModels.formatQty(info.qty, 2)}`;
    document.getElementById('coItemUnit').value = info.unit;
    document.getElementById('coItemUnitCost').value = conditionUnitCost(project, takeoff.conditionId).toFixed(2);
  }

  function addDraftItem() {
    const project = currentProject();
    const type = document.getElementById('coItemType').value;
    const qty = number(document.getElementById('coItemQty').value);
    const unit = String(document.getElementById('coItemUnit').value || '').trim();
    const unitCost = number(document.getElementById('coItemUnitCost').value);
    if (!qty) return alert('Enter a non-zero quantity or quantity delta.');
    if (unitCost < 0) return alert('Unit cost cannot be negative. Use a negative quantity for a credit.');

    if (type === 'linked') {
      const linkedTakeoffId = document.getElementById('coLinkedTakeoff').value;
      const takeoff = (project?.takeoffs || []).find((item) => item.id === linkedTakeoffId);
      if (!takeoff) return alert('Choose an existing takeoff object.');
      const info = objectQuantity(project, takeoff);
      draftItems.push({
        id: uid(),
        type: 'linked',
        description: `${info.condition?.name || 'Takeoff'} quantity change`,
        linkedTakeoffId,
        conditionId: takeoff.conditionId,
        pageId: takeoff.pageId,
        quantityDelta: qty,
        unit: unit || info.unit,
        unitCost,
        total: qty * unitCost,
        generatedTakeoffIds: [],
      });
    } else {
      const description = String(document.getElementById('coManualDescription').value || '').trim();
      if (!description) return alert('Enter the manual line description.');
      draftItems.push({
        id: uid(),
        type: 'manual',
        description,
        qty,
        unit: unit || 'LS',
        unitCost,
        total: qty * unitCost,
        generatedTakeoffIds: [],
      });
      document.getElementById('coManualDescription').value = '';
    }

    document.getElementById('coItemQty').value = '';
    renderDraftItems();
  }

  function draftTotal() {
    return draftItems.reduce((sum, item) => sum + number(item.total), 0);
  }

  function renderDraftItems() {
    const container = document.getElementById('changeOrderDraftItems');
    const total = document.getElementById('changeOrderDraftTotal');
    if (total) total.textContent = money(draftTotal());
    if (!container) return;
    container.innerHTML = draftItems.length
      ? draftItems.map((item) => `
        <div class="co-draft-row" data-item-id="${esc(item.id)}">
          <span><strong>${esc(item.description)}</strong><br><span style="color:var(--text-dim)">${esc(item.type === 'linked' ? 'Linked takeoff' : 'Manual line')} · ${window.PTModels.formatQty(item.type === 'linked' ? item.quantityDelta : item.qty, 2)} ${esc(item.unit)}</span></span>
          <strong>${money(item.total)}</strong>
          <button type="button" data-remove-item="${esc(item.id)}">Remove</button>
        </div>`).join('')
      : '<div style="color:var(--text-dim);font-size:11px">Add at least one linked or manual item.</div>';
    container.querySelectorAll('[data-remove-item]').forEach((button) => {
      button.addEventListener('click', () => {
        draftItems = draftItems.filter((item) => item.id !== button.dataset.removeItem);
        renderDraftItems();
      });
    });
  }

  async function createChangeOrder(event) {
    event.preventDefault();
    const project = currentProject();
    const path = folderPath(project);
    const description = String(document.getElementById('coDescription').value || '').trim();
    const date = document.getElementById('coDate').value || new Date().toISOString().slice(0, 10);
    if (!project || !path) return alert('Open a disk-backed EST job first.');
    if (!description) return alert('Enter a change order description.');
    if (!draftItems.length) return alert('Add at least one change order item.');

    const changeOrder = {
      id: uid(),
      date,
      description,
      status: 'Pending',
      items: clone(draftItems),
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      totalImpact: draftTotal(),
    };
    try {
      const result = await window.PTEstimates.saveChangeOrders(path, [...orders, changeOrder]);
      applyServerResult(result);
      draftItems = [];
      document.getElementById('coDescription').value = '';
      renderDraftItems();
      render();
      alert('Change order created as Pending.');
    } catch (error) {
      alert(`Could not create change order: ${error.message || error}`);
    }
  }

  function normalizeOrders(list) {
    return (Array.isArray(list) ? list : []).map((order) => ({
      ...order,
      items: Array.isArray(order.items) ? order.items : [],
      totalImpact: number(order.totalImpact),
    }));
  }

  function applyServerResult(result) {
    orders = normalizeOrders(result?.changeOrders);
    diskJob = result?.job || diskJob;
    const path = folderPath();
    const scanned = (window.PTEstimates?.lastScan?.projects || []).find((project) => project.folder_path === path);
    if (scanned && diskJob) {
      scanned.job = clone(diskJob);
      scanned.change_orders = clone(orders);
      scanned.change_order_summary = clone(result?.summary || {});
    }
    updateTabBadge();
    decorateCommandCenter();
    window.dispatchEvent(new CustomEvent('pt:change-orders-updated', {
      detail: { path, job: clone(diskJob), changeOrders: clone(orders) },
    }));
  }

  async function loadOrders(force = false) {
    const project = currentProject();
    const path = folderPath(project);
    if (!project || !path) {
      activeFolder = '';
      orders = [];
      diskJob = null;
      render();
      return;
    }
    if (!force && path === activeFolder && orders.length) {
      render();
      return;
    }
    if (loading) return;
    loading = true;
    activeFolder = path;
    renderMessage('Loading change orders…');
    try {
      const result = await window.PTEstimates.getProject(path);
      orders = normalizeOrders(result?.change_orders);
      diskJob = result?.job || null;
      const scanned = (window.PTEstimates?.lastScan?.projects || []).find((item) => item.folder_path === path);
      if (scanned) {
        scanned.job = clone(diskJob);
        scanned.change_orders = clone(orders);
        scanned.change_order_summary = clone(result?.change_order_summary || {});
      }
      fillTakeoffSelect();
      render();
    } catch (error) {
      renderMessage(error.message || String(error));
    } finally {
      loading = false;
    }
  }

  function orderItemText(item) {
    if (item.type === 'linked') {
      return `${item.description || 'Linked takeoff'} · ${window.PTModels.formatQty(item.quantityDelta, 2)} ${item.unit || ''}`;
    }
    return `${item.description || 'Manual line'} · ${window.PTModels.formatQty(item.qty, 2)} ${item.unit || ''}`;
  }

  function renderMessage(message) {
    const list = document.getElementById('changeOrderList');
    if (list) list.innerHTML = `<div style="padding:22px;text-align:center;color:var(--text-dim)">${esc(message)}</div>`;
  }

  function summaryValues() {
    const baseline = number(
      diskJob?.baselineEstimate?.totals?.grand ||
      diskJob?.baselineEstimate?.estimatedTotal ||
      diskJob?.estimatedTotal
    );
    const approved = orders.filter((order) => order.status === 'Approved')
      .reduce((sum, order) => sum + number(order.totalImpact), 0);
    const pending = orders.filter((order) => order.status === 'Pending')
      .reduce((sum, order) => sum + number(order.totalImpact), 0);
    const running = number(diskJob?.runningTotal || baseline + approved);
    return { baseline, approved, pending, running };
  }

  function render() {
    const panel = document.getElementById('panel-change-orders');
    if (!panel) return;
    const project = currentProject();
    const summary = document.getElementById('changeOrderSummary');
    const list = document.getElementById('changeOrderList');
    const count = document.getElementById('changeOrderCount');
    if (!project || !folderPath(project)) {
      if (summary) summary.innerHTML = '';
      if (list) list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim)">Open an EST job to manage change orders.</div>';
      return;
    }

    const values = summaryValues();
    if (summary) summary.innerHTML = [
      ['Baseline Estimate', money(values.baseline)],
      ['Approved CO Impact', money(values.approved)],
      ['Pending CO Impact', money(values.pending)],
      ['Running Job Total', money(values.running)],
    ].map(([label, value]) => `<div class="co-summary-card"><div class="co-summary-label">${esc(label)}</div><div class="co-summary-value">${esc(value)}</div></div>`).join('');
    if (count) count.textContent = String(orders.length);
    updateTabBadge();
    fillTakeoffSelect();

    if (!list) return;
    list.innerHTML = orders.length ? [...orders].reverse().map((order) => `
      <article class="co-card" data-co-id="${esc(order.id)}" data-status="${esc(order.status)}">
        <div class="co-card-top">
          <div><div class="co-card-title">${esc(order.description)}</div><div class="co-card-date">${esc(dateLabel(order.date))}</div></div>
          <span class="co-status ${esc(order.status)}">${esc(order.status)}</span>
        </div>
        <div class="co-impact">${money(order.totalImpact)}</div>
        <div class="co-items">${(order.items || []).map((item) => `<div class="co-item-line"><span>${esc(orderItemText(item))}</span><span>${money(item.total)}</span></div>`).join('')}</div>
        ${order.status === 'Pending' ? `<div class="co-actions"><button type="button" class="primary" data-approve-co="${esc(order.id)}">Approve</button><button type="button" class="danger" data-reject-co="${esc(order.id)}">Reject</button></div>` : ''}
      </article>`).join('') : '<div style="padding:24px;text-align:center;color:var(--text-dim)">No change orders yet.</div>';

    list.querySelectorAll('[data-approve-co]').forEach((button) => {
      button.addEventListener('click', () => approveChangeOrder(button.dataset.approveCo, button));
    });
    list.querySelectorAll('[data-reject-co]').forEach((button) => {
      button.addEventListener('click', () => rejectChangeOrder(button.dataset.rejectCo, button));
    });
  }

  function dateLabel(value) {
    const date = new Date(`${value || ''}T12:00:00`);
    return Number.isNaN(date.getTime()) ? String(value || '—') : DATE.format(date);
  }

  function translatedGeometry(geometry, offset) {
    const points = (geometry?.points || []).map((point) => ({
      x: number(point.x) + offset,
      y: number(point.y) + offset,
    }));
    return { ...(clone(geometry) || {}), points };
  }

  function buildLinkedTakeoff(project, order, item, index) {
    const source = (project.takeoffs || []).find((takeoff) => takeoff.id === item.linkedTakeoffId);
    if (!source) throw new Error(`Linked takeoff not found for “${item.description || order.description}”.`);
    const info = objectQuantity(project, source);
    const delta = number(item.quantityDelta);
    if (!delta) throw new Error('Linked quantity delta cannot be zero.');
    const sourceQty = Math.abs(number(info.qty));
    if (!(sourceQty > 0)) throw new Error('Linked takeoff has no measurable quantity. Verify the page scale first.');

    const sourceMultiplier = Math.max(0.000001, number(source.multiplier) || 1);
    const baseQty = sourceQty / sourceMultiplier;
    const multiplier = Math.abs(delta) / baseQty;
    const deduct = delta < 0;
    const kind = source.kind === 'deduction' ? 'polygon' : source.kind;
    const object = window.PTModels.createTakeoffObject(
      source.conditionId,
      kind,
      translatedGeometry(source.geometry, 6 + index * 3),
      {
        pageId: source.pageId,
        multiplier,
        parentId: null,
        isDeduct: deduct,
        isDeduction: deduct,
        label: `CO ${order.id.slice(0, 8)} · ${order.description}`,
        changeOrderId: order.id,
        changeOrderItemId: item.id,
        linkedTakeoffId: source.id,
        changeOrderQuantityDelta: delta,
        changeOrderType: deduct ? 'deduct' : 'additive',
        isChangeOrder: true,
        excludeFromBaseEstimate: true,
        role: source.role || null,
      }
    );
    return object;
  }

  async function approveChangeOrder(orderId, control) {
    const project = currentProject();
    const path = folderPath(project);
    const order = orders.find((item) => item.id === orderId);
    if (!project || !path || !order || order.status !== 'Pending') return;
    if (!confirm(`Approve “${order.description}” for ${money(order.totalImpact)}?\n\nLinked quantity deltas will be added to the visual takeoff plan.`)) return;

    if (control) control.disabled = true;
    const created = [];
    try {
      let linkedIndex = 0;
      for (const item of order.items || []) {
        if (item.type !== 'linked') continue;
        const object = buildLinkedTakeoff(project, order, item, linkedIndex++);
        created.push(object);
        item.generatedTakeoffIds = [object.id];
      }
      project.takeoffs.push(...created);
      await persistProject(project);

      const nextOrders = orders.map((item) => item.id === orderId
        ? { ...item, status: 'Approved', updated: new Date().toISOString(), items: clone(order.items) }
        : item);
      const result = await window.PTEstimates.saveChangeOrders(path, nextOrders);
      applyServerResult(result);
      window.PTHistory?.recordChangeOrder?.(
        result.changeOrders.find((item) => item.id === orderId) || order,
        created
      );
      render();
      alert(`Change order approved.\n\nRunning job total: ${money(result?.job?.runningTotal)}`);
    } catch (error) {
      if (created.length) {
        const ids = new Set(created.map((object) => object.id));
        project.takeoffs = project.takeoffs.filter((takeoff) => !ids.has(takeoff.id));
        try { await persistProject(project); } catch (_) { /* best effort rollback */ }
      }
      for (const item of order.items || []) item.generatedTakeoffIds = [];
      alert(`Could not approve change order: ${error.message || error}`);
    } finally {
      if (control) control.disabled = false;
    }
  }

  async function rejectChangeOrder(orderId, control) {
    const path = folderPath();
    const order = orders.find((item) => item.id === orderId);
    if (!path || !order || order.status !== 'Pending') return;
    if (!confirm(`Reject “${order.description}”?`)) return;
    if (control) control.disabled = true;
    try {
      const nextOrders = orders.map((item) => item.id === orderId
        ? { ...item, status: 'Rejected', updated: new Date().toISOString() }
        : item);
      const result = await window.PTEstimates.saveChangeOrders(path, nextOrders);
      applyServerResult(result);
      render();
    } catch (error) {
      alert(`Could not reject change order: ${error.message || error}`);
    } finally {
      if (control) control.disabled = false;
    }
  }

  function updateTabBadge() {
    const badge = document.getElementById('changeOrdersTabBadge');
    if (!badge) return;
    const pending = orders.filter((order) => order.status === 'Pending').length ||
      number(diskJob?.pendingChangeOrderCount);
    badge.innerHTML = pending ? `<span class="co-pending-badge">${pending}</span>` : '';
  }

  function decorateCommandCenter() {
    const scan = window.PTEstimates?.lastScan?.projects || [];
    document.querySelectorAll('#commandCenterBoard .cc-card').forEach((card) => {
      const project = scan.find((item) => item.folder_path === card.dataset.path);
      const pending = number(project?.job?.pendingChangeOrderCount || project?.change_order_summary?.pendingChangeOrderCount);
      const title = card.querySelector('.cc-card-name');
      const old = title?.querySelector('.co-pending-badge');
      if (old) old.remove();
      if (pending > 0 && title) {
        title.insertAdjacentHTML('beforeend', `<span class="co-pending-badge" title="${pending} pending change order${pending === 1 ? '' : 's'}">${pending} CO</span>`);
      }
    });
  }

  function installCommandCenterObserver() {
    const board = document.getElementById('commandCenterBoard');
    if (!board || commandObserver) return !!board;
    commandObserver = new MutationObserver(() => decorateCommandCenter());
    commandObserver.observe(board, { childList: true, subtree: true });
    decorateCommandCenter();
    return true;
  }

  function installAll() {
    captureStore();
    installApi();
    installModelExtension();
    installHistoryExtension();
    installStyles();
    installTab();
    installCommandCenterObserver();
  }

  window.PTChangeOrders = {
    load: loadOrders,
    getOrders: () => clone(orders),
    approve: approveChangeOrder,
    reject: rejectChangeOrder,
  };

  captureStore();
  document.addEventListener('DOMContentLoaded', () => {
    installAll();
    let ticks = 0;
    const timer = setInterval(() => {
      installAll();
      const path = folderPath();
      if (path !== activeFolder) {
        activeFolder = path;
        orders = [];
        diskJob = null;
        draftItems = [];
        renderDraftItems();
        if (path) loadOrders(true);
        else render();
      } else {
        updateTabBadge();
        decorateCommandCenter();
      }
      ticks += 1;
      if (ticks > 300 && !currentProject()) clearInterval(timer);
    }, 500);
  });

  window.addEventListener('pt:jobs-scan', () => setTimeout(decorateCommandCenter, 0));
  window.addEventListener('pt:job-finalized', () => loadOrders(true));
})();

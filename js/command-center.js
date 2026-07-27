/**
 * PlanTakeoff Command Center — disk-backed Buildertrend-style pipeline view.
 * Uses /api/scan and /api/job/update; existing library/takeoff paths stay authoritative.
 */
(function () {
  'use strict';

  const PIPELINE_STATUSES = [
    'Lead',
    'Estimating',
    'Bid Sent',
    'Awarded',
    'In Progress',
    'Punch',
    'Complete',
    'Lost',
  ];

  const CURRENCY = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  let jobs = [];
  let loading = false;
  let dragJobId = null;
  let defaultActivated = false;
  let userNavigated = false;
  let scanPatched = false;
  let libraryPatched = false;

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function normalizeProject(project) {
    const normalize = window.PTJobs?.normalizeJob;
    const job = normalize
      ? normalize(project?.job || {}, project || {})
      : {
          ...(project?.job || {}),
          id: project?.job?.id || project?.folder_path,
          name: project?.job?.name || project?.project_name || project?.folder_name || 'Untitled Job',
          path: project?.job?.path || project?.folder_path || '',
          status: PIPELINE_STATUSES.includes(project?.job?.status) ? project.job.status : 'Lead',
          clientName: project?.job?.clientName || '',
          estimatedTotal: Number(project?.job?.estimatedTotal) || 0,
          updated: project?.job?.updated || project?.modified || '',
          notes: project?.job?.notes || '',
        };
    return { ...project, job };
  }

  function money(value) {
    return CURRENCY.format(Number(value) || 0);
  }

  function dateLabel(value) {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
  }

  function isThisMonth(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return false;
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }

  function installStyles() {
    if (document.getElementById('commandCenterStyles')) return;
    const style = document.createElement('style');
    style.id = 'commandCenterStyles';
    style.textContent = `
      #commandCenterTab{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border:0;border-right:1px solid var(--border);background:transparent;color:var(--text-dim);font-weight:700;cursor:pointer}
      #commandCenterTab:hover,#commandCenterTab.active{background:var(--bg-panel);color:var(--text)}
      #panel-command-center{padding:16px;overflow:auto;background:var(--bg)}
      .cc-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
      .cc-title h2{margin:0;font-size:22px}.cc-title p{margin:4px 0 0;color:var(--text-dim);font-size:12px}
      .cc-actions{display:flex;align-items:center;gap:8px}.cc-search{width:min(340px,38vw);min-width:210px}
      .cc-kpis{display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px;margin-bottom:16px}
      .cc-kpi{border:1px solid var(--border);background:var(--bg-panel);border-radius:10px;padding:14px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
      .cc-kpi-label{color:var(--text-dim);font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
      .cc-kpi-value{font-size:26px;font-weight:800;margin-top:5px}.cc-kpi-sub{color:var(--text-dim);font-size:11px;margin-top:4px}
      .cc-board-wrap{overflow-x:auto;padding-bottom:10px}.cc-board{display:grid;grid-template-columns:repeat(8,minmax(255px,1fr));gap:10px;min-width:2080px;align-items:start}
      .cc-column{border:1px solid var(--border);background:color-mix(in srgb,var(--bg-panel) 78%,transparent);border-radius:10px;min-height:310px;overflow:hidden}
      .cc-column.drag-over{outline:2px solid #5b8cff;outline-offset:2px}.cc-column[data-status="Lost"]{opacity:.78}
      .cc-column-head{display:flex;align-items:center;justify-content:space-between;padding:10px 11px;border-bottom:1px solid var(--border);font-weight:800;font-size:12px;position:sticky;top:0;background:var(--bg-panel);z-index:1}
      .cc-count{display:inline-flex;min-width:22px;height:22px;align-items:center;justify-content:center;border-radius:999px;background:var(--bg-input);color:var(--text-dim);font-size:11px}
      .cc-card-list{padding:9px;display:flex;flex-direction:column;gap:9px;min-height:250px}
      .cc-card{border:1px solid var(--border);border-left:4px solid #5b8cff;background:var(--bg-panel);border-radius:8px;padding:10px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}
      .cc-card:hover{transform:translateY(-1px);border-color:#5b8cff}.cc-card.dragging{opacity:.45}
      .cc-card-name{font-weight:800;font-size:13px;line-height:1.3}.cc-card-client{color:var(--text-dim);font-size:11px;margin-top:3px;min-height:15px}
      .cc-card-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px;padding-top:8px;border-top:1px solid var(--border);font-size:11px}
      .cc-card-meta span:last-child{text-align:right;color:var(--text-dim)}
      .cc-card-actions{display:flex;align-items:center;gap:5px;margin-top:9px}.cc-card-actions button,.cc-card-actions select{font-size:10px;padding:5px 6px;min-width:0}
      .cc-card-actions select{flex:1;max-width:108px}.cc-note-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#f59e0b;margin-left:5px}
      .cc-empty{color:var(--text-dim);font-size:11px;text-align:center;padding:28px 8px}.cc-message{padding:32px;text-align:center;color:var(--text-dim)}
      @media(max-width:900px){.cc-kpis{grid-template-columns:repeat(2,1fr)}.cc-head{align-items:flex-start;flex-direction:column}.cc-search{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function installView() {
    if (document.getElementById('panel-command-center')) return true;
    const tabBar = document.getElementById('tabBar');
    const panels = document.querySelector('.tab-panels');
    if (!tabBar || !panels) return false;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'commandCenterTab';
    button.textContent = 'Command Center';
    button.title = 'Company pipeline overview';
    tabBar.insertBefore(button, tabBar.firstChild);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.id = 'panel-command-center';
    panel.innerHTML = `
      <div class="cc-head">
        <div class="cc-title"><h2>Command Center</h2><p>Disk-backed EST job pipeline</p></div>
        <div class="cc-actions">
          <input id="commandCenterSearch" class="cc-search" type="search" placeholder="Search jobs or clients…" />
          <button type="button" id="commandCenterRefresh">Refresh</button>
        </div>
      </div>
      <div class="cc-kpis" id="commandCenterKpis"></div>
      <div class="cc-board-wrap"><div class="cc-board" id="commandCenterBoard"></div></div>`;
    panels.insertBefore(panel, panels.firstChild);

    button.addEventListener('click', () => {
      userNavigated = true;
      activate();
      refreshJobs();
    });
    panel.querySelector('#commandCenterSearch').addEventListener('input', render);
    panel.querySelector('#commandCenterRefresh').addEventListener('click', refreshJobs);

    document.querySelectorAll('#tabBar .tab').forEach((tab) => {
      tab.addEventListener('click', (event) => {
        if (event.isTrusted) userNavigated = true;
        button.classList.remove('active');
      });
    });
    return true;
  }

  function activate() {
    const panel = document.getElementById('panel-command-center');
    const button = document.getElementById('commandCenterTab');
    if (!panel || !button) return;
    document.querySelectorAll('.panel').forEach((item) => item.classList.toggle('active', item === panel));
    document.querySelectorAll('#tabBar .tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    render();
  }

  function patchEstimateApi() {
    const E = window.PTEstimates;
    if (!E) return false;

    if (!libraryPatched && typeof E.renderLibrary === 'function') {
      libraryPatched = true;
      const originalRender = E.renderLibrary;
      E.renderLibrary = function commandCenterCaptureOpen(container, projects, handlers = {}) {
        if (typeof handlers.onOpenBid === 'function') E._openBidHandler = handlers.onOpenBid;
        return originalRender.call(this, container, projects, handlers);
      };
    }

    if (!scanPatched && typeof E.scan === 'function') {
      scanPatched = true;
      const originalScan = E.scan;
      E.scan = async function commandCenterScan(...args) {
        const result = await originalScan.apply(this, args);
        jobs = (result?.projects || []).map(normalizeProject);
        window.dispatchEvent(new CustomEvent('pt:jobs-scan', { detail: { projects: jobs } }));
        if (document.getElementById('commandCenterTab')?.classList.contains('active')) render();
        return result;
      };
    }
    return true;
  }

  async function refreshJobs() {
    const E = window.PTEstimates;
    if (!E || loading) return;
    loading = true;
    renderMessage('Scanning EST folders…');
    try {
      if (!(await E.init())) throw new Error('Local server offline — run Launch PlanTakeoff.bat');
      const result = await E.scan();
      jobs = (result?.projects || []).map(normalizeProject);
      render();
    } catch (error) {
      renderMessage(error.message || String(error));
    } finally {
      loading = false;
    }
  }

  function filteredJobs() {
    const query = (document.getElementById('commandCenterSearch')?.value || '').trim().toLowerCase();
    if (!query) return jobs;
    return jobs.filter((project) => {
      const job = project.job;
      return `${job.name} ${job.clientName} ${project.bid_ref || ''} ${project.folder_name || ''}`.toLowerCase().includes(query);
    });
  }

  function renderMessage(message) {
    const board = document.getElementById('commandCenterBoard');
    const kpis = document.getElementById('commandCenterKpis');
    if (kpis) kpis.innerHTML = '';
    if (board) board.innerHTML = `<div class="cc-message" style="grid-column:1/-1">${esc(message)}</div>`;
  }

  function render() {
    const board = document.getElementById('commandCenterBoard');
    const kpis = document.getElementById('commandCenterKpis');
    if (!board || !kpis) return;

    const visible = filteredJobs();
    const active = jobs.filter((project) => !['Complete', 'Lost'].includes(project.job.status)).length;
    const bidsOut = jobs.filter((project) => project.job.status === 'Bid Sent').length;
    const inProgress = jobs.filter((project) => project.job.status === 'In Progress').length;
    const revenue = jobs
      .filter((project) => ['Awarded', 'Complete'].includes(project.job.status) && isThisMonth(project.job.updated || project.job.created))
      .reduce((sum, project) => sum + (Number(project.job.estimatedTotal) || 0), 0);

    const cards = [
      ['Active Jobs', active, 'All statuses except Complete and Lost'],
      ['Bids Out', bidsOut, 'Jobs currently at Bid Sent'],
      ['In Progress', inProgress, 'Active production jobs'],
      ['This Month Revenue', money(revenue), 'Awarded + Complete, based on job update month'],
    ];
    kpis.innerHTML = cards.map(([label, value, sub]) => `
      <div class="cc-kpi"><div class="cc-kpi-label">${esc(label)}</div><div class="cc-kpi-value">${esc(value)}</div><div class="cc-kpi-sub">${esc(sub)}</div></div>`).join('');

    board.innerHTML = PIPELINE_STATUSES.map((status) => {
      const list = visible.filter((project) => project.job.status === status);
      return `<section class="cc-column" data-status="${esc(status)}">
        <div class="cc-column-head"><span>${esc(status)}</span><span class="cc-count">${list.length}</span></div>
        <div class="cc-card-list">${list.length ? list.map(cardHtml).join('') : '<div class="cc-empty">Drop a job here</div>'}</div>
      </section>`;
    }).join('');

    bindBoard();
  }

  function cardHtml(project) {
    const job = project.job;
    const note = job.notes ? '<span class="cc-note-dot" title="Has notes"></span>' : '';
    return `<article class="cc-card" draggable="true" data-job-id="${esc(job.id)}" data-path="${esc(project.folder_path || job.path)}">
      <div class="cc-card-name">${esc(job.name)}${note}</div>
      <div class="cc-card-client">${esc(job.clientName || 'No client entered')}</div>
      <div class="cc-card-meta"><strong>${money(job.estimatedTotal)}</strong><span>${dateLabel(job.updated)}</span></div>
      <div class="cc-card-actions">
        <button type="button" data-action="open">Open Takeoff</button>
        <select data-action="status" aria-label="Change Status" title="Change Status">${PIPELINE_STATUSES.map((status) => `<option value="${esc(status)}"${status === job.status ? ' selected' : ''}>${esc(status)}</option>`).join('')}</select>
        <button type="button" data-action="note">Add Note</button>
      </div>
    </article>`;
  }

  function bindBoard() {
    document.querySelectorAll('.cc-card').forEach((card) => {
      const project = jobs.find((item) => item.job.id === card.dataset.jobId);
      card.addEventListener('click', (event) => {
        if (event.target.closest('button,select,option')) return;
        openJob(project);
      });
      card.addEventListener('dragstart', (event) => {
        dragJobId = card.dataset.jobId;
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragJobId);
      });
      card.addEventListener('dragend', () => {
        dragJobId = null;
        card.classList.remove('dragging');
        document.querySelectorAll('.cc-column').forEach((column) => column.classList.remove('drag-over'));
      });
      card.querySelector('[data-action="open"]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        openJob(project);
      });
      card.querySelector('[data-action="status"]')?.addEventListener('change', (event) => {
        event.stopPropagation();
        changeStatus(project, event.target.value, event.target);
      });
      card.querySelector('[data-action="note"]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        addNote(project);
      });
    });

    document.querySelectorAll('.cc-column').forEach((column) => {
      column.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        column.classList.add('drag-over');
      });
      column.addEventListener('dragleave', (event) => {
        if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over');
      });
      column.addEventListener('drop', (event) => {
        event.preventDefault();
        column.classList.remove('drag-over');
        const id = event.dataTransfer.getData('text/plain') || dragJobId;
        const project = jobs.find((item) => item.job.id === id);
        if (project) changeStatus(project, column.dataset.status);
      });
    });
  }

  async function changeStatus(project, status, control) {
    if (!project || !PIPELINE_STATUSES.includes(status) || project.job.status === status) return;
    const E = window.PTEstimates;
    const previous = project.job.status;
    if (control) control.disabled = true;
    project.job.status = status;
    project.job.updated = new Date().toISOString().slice(0, 19);
    render();
    try {
      const saved = await E.updateJob(project.folder_path || project.job.path, {
        status,
        notes: project.job.notes,
      });
      project.job = window.PTJobs?.normalizeJob
        ? window.PTJobs.normalizeJob(saved, project)
        : { ...project.job, ...saved };
      syncScanProject(project);
      render();
    } catch (error) {
      project.job.status = previous;
      if (control) control.value = previous;
      render();
      alert(`Status update failed: ${error.message || error}`);
    } finally {
      if (control) control.disabled = false;
    }
  }

  async function addNote(project) {
    if (!project) return;
    const text = prompt(`Add note for ${project.job.name}:`, '');
    if (text == null || !text.trim()) return;
    const stamp = new Date().toLocaleString('en-US');
    const notes = `[${stamp}] ${text.trim()}${project.job.notes ? `\n${project.job.notes}` : ''}`;
    try {
      const saved = await window.PTEstimates.updateJob(project.folder_path || project.job.path, {
        status: project.job.status,
        notes,
      });
      project.job = window.PTJobs?.normalizeJob
        ? window.PTJobs.normalizeJob(saved, project)
        : { ...project.job, ...saved };
      syncScanProject(project);
      render();
    } catch (error) {
      alert(`Could not save note: ${error.message || error}`);
    }
  }

  function syncScanProject(project) {
    const list = window.PTEstimates?.lastScan?.projects || [];
    const original = list.find((item) => item.folder_path === project.folder_path);
    if (original) original.job = { ...project.job };
  }

  async function openJob(project) {
    if (!project) return;
    const E = window.PTEstimates;
    if (typeof E?._openBidHandler === 'function') {
      await E._openBidHandler(project);
      document.getElementById('commandCenterTab')?.classList.remove('active');
      return;
    }

    // Ask the existing Library view to initialize its private takeoff callback,
    // then use that exact callback rather than duplicating import/open logic.
    const libraryTab = document.querySelector('#tabBar .tab[data-tab="library"]');
    libraryTab?.click();
    for (let i = 0; i < 40; i += 1) {
      if (typeof E?._openBidHandler === 'function') {
        await E._openBidHandler(project);
        document.getElementById('commandCenterTab')?.classList.remove('active');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    alert('Could not initialize the existing takeoff opener. Open the Estimates Library once, then try again.');
  }

  function installAll() {
    installStyles();
    installView();
    patchEstimateApi();
  }

  window.addEventListener('pt:jobs-scan', (event) => {
    jobs = (event.detail?.projects || []).map(normalizeProject);
    render();
  });

  document.addEventListener('DOMContentLoaded', () => {
    installAll();
    let tries = 0;
    const timer = setInterval(() => {
      installAll();
      tries += 1;
      if (tries >= 80 || (window.PTEstimates && document.getElementById('panel-command-center'))) clearInterval(timer);
    }, 100);

    // App bootstrap may restore Library/Takeoff. Reassert Command Center once,
    // after startup, unless the user has already deliberately navigated.
    setTimeout(async () => {
      if (userNavigated || defaultActivated) return;
      defaultActivated = true;
      activate();
      await refreshJobs();
    }, 1200);
  });
})();

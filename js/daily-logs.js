/**
 * PlanTakeoff offline-first daily job-site logging.
 * Persists daily-logs.json inside the active EST folder and decorates the
 * Command Center with last-log age and current completion.
 */
(function () {
  'use strict';

  const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  let appState = null;
  let activeFolder = '';
  let logs = [];
  let diskJob = null;
  let photoDrafts = [];
  let loading = false;
  let apiInstalled = false;
  let commandObserver = null;
  let promptBusy = false;

  const clone = (value) => {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  };
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const clampPercent = (value) => Math.max(0, Math.min(100, number(value)));
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => window.PTModels?.uid?.() ||
    (crypto.randomUUID ? crypto.randomUUID() : `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  function captureStore() {
    const S = window.PTStore;
    if (!S || S.__dailyLogCapture) return !!S;
    S.__dailyLogCapture = true;

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

  function scanProject(path) {
    return (window.PTEstimates?.lastScan?.projects || []).find((project) => project.folder_path === path) || null;
  }

  function syncScan(path, result) {
    const project = scanProject(path);
    if (!project) return;
    if (result?.job) project.job = clone(result.job);
    if (result?.dailyLogs) project.daily_logs = clone(result.dailyLogs);
    if (result?.summary) project.daily_log_summary = clone(result.summary);
  }

  function installApi() {
    const E = window.PTEstimates;
    if (!E || apiInstalled || typeof E.updateJob !== 'function') return false;
    apiInstalled = true;

    E.saveDailyLog = async function saveDailyLog(path, log) {
      const response = await fetch('/api/daily-logs/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, log }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || response.statusText || 'Could not save daily log');
      return data;
    };

    const originalUpdateJob = E.updateJob;
    E.updateJob = async function updateJobWithFirstLogPrompt(path, updates = {}) {
      const saved = await originalUpdateJob.call(this, path, updates);
      const scanned = scanProject(path);
      if (scanned) scanned.job = clone(saved);
      if (updates.status === 'In Progress') {
        const count = number(saved?.dailyLogCount || scanned?.daily_log_summary?.dailyLogCount);
        if (count === 0) queueFirstLogPrompt(path);
      }
      return saved;
    };
    return true;
  }

  function installStyles() {
    if (document.getElementById('dailyLogStyles')) return;
    const style = document.createElement('style');
    style.id = 'dailyLogStyles';
    style.textContent = `
      #panel-daily-logs{padding:14px;overflow:auto;background:var(--bg)}
      .dl-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
      .dl-head h2{margin:0;font-size:20px}.dl-head p{margin:3px 0 0;color:var(--text-dim);font-size:12px}
      .dl-summary{display:grid;grid-template-columns:repeat(4,minmax(145px,1fr));gap:10px;margin-bottom:14px}
      .dl-summary-card{border:1px solid var(--border);background:var(--bg-panel);border-radius:9px;padding:12px}
      .dl-summary-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);font-weight:800}
      .dl-summary-value{font-size:21px;font-weight:800;margin-top:4px}
      .dl-layout{display:grid;grid-template-columns:minmax(390px,.85fr) minmax(440px,1.15fr);gap:14px;align-items:start}
      .dl-pane{border:1px solid var(--border);background:var(--bg-panel);border-radius:10px;overflow:hidden}
      .dl-pane-head{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;border-bottom:1px solid var(--border);font-weight:800}
      .dl-form{padding:12px}.dl-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
      .dl-form-grid .full{grid-column:1/-1}.dl-form label{display:block;font-size:11px;color:var(--text-dim);font-weight:700;margin-bottom:4px}
      .dl-form textarea{min-height:78px;resize:vertical}.dl-percent-row{display:grid;grid-template-columns:140px 1fr;gap:8px}
      .dl-auto-note{font-size:10px;color:var(--text-dim);margin-top:4px}
      .dl-photo-preview{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}.dl-photo-thumb{position:relative;width:90px;height:68px;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-input)}
      .dl-photo-thumb img{width:100%;height:100%;object-fit:cover}.dl-photo-thumb button{position:absolute;right:2px;top:2px;padding:1px 5px;font-size:10px}
      .dl-list{padding:10px;display:flex;flex-direction:column;gap:9px;max-height:calc(100vh - 285px);overflow:auto}
      .dl-card{border:1px solid var(--border);border-left:4px solid #2563eb;border-radius:8px;background:var(--bg-input);padding:10px}
      .dl-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dl-card-title{font-weight:800}.dl-card-meta{color:var(--text-dim);font-size:11px;margin-top:2px}
      .dl-percent{font-size:18px;font-weight:900;white-space:nowrap}.dl-section{margin-top:8px;padding-top:7px;border-top:1px solid var(--border);font-size:12px;white-space:pre-wrap}
      .dl-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);font-weight:800;margin-bottom:3px}
      .dl-issues{border-left:3px solid #dc2626;padding-left:8px}.dl-photos{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}
      .dl-photos img{width:112px;height:82px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}
      .dl-photo-path{font-size:10px;padding:5px 7px;border:1px solid var(--border);border-radius:5px;background:var(--bg-panel);word-break:break-all}
      .daily-log-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;font-size:10px;color:var(--text-dim)}
      .daily-log-card-meta strong{color:var(--text);font-size:11px}.daily-log-stale{color:#dc2626!important}
      @media(max-width:980px){.dl-layout{grid-template-columns:1fr}.dl-summary{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function installTab() {
    if (document.querySelector('[data-tab="daily-logs"]')) return true;
    const tabBar = document.getElementById('tabBar');
    const panels = document.querySelector('.tab-panels');
    if (!tabBar || !panels) return false;

    const changeTab = tabBar.querySelector('[data-tab="change-orders"]');
    const estimateTab = tabBar.querySelector('[data-tab="estimate"]');
    const anchor = changeTab || estimateTab;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab locked';
    tab.dataset.tab = 'daily-logs';
    tab.textContent = 'Daily Logs';
    tab.title = 'Offline job-site progress and communication logs';
    if (anchor?.nextSibling) tabBar.insertBefore(tab, anchor.nextSibling);
    else tabBar.appendChild(tab);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.id = 'panel-daily-logs';
    panel.innerHTML = `
      <div class="dl-head">
        <div><h2>Daily Logs</h2><p>Job-site progress, crew activity, photos, and issues stored in this EST folder.</p></div>
        <button type="button" id="btnRefreshDailyLogs">Refresh</button>
      </div>
      <div class="dl-summary" id="dailyLogSummary"></div>
      <div class="dl-layout">
        <section class="dl-pane">
          <div class="dl-pane-head"><span>Add Today’s Log</span><span id="dailyLogFormStatus">Offline-first</span></div>
          <form class="dl-form" id="dailyLogForm">
            <div class="dl-form-grid">
              <div><label for="dailyLogDate">Date</label><input type="date" id="dailyLogDate" required /></div>
              <div><label for="dailyLogWeather">Weather</label><input type="text" id="dailyLogWeather" placeholder="Clear, 78°F, light wind" /></div>
              <div><label for="dailyLogCrew">Crew count</label><input type="number" id="dailyLogCrew" min="0" step="1" value="0" /></div>
              <div><label for="dailyLogHours">Hours per person</label><input type="number" id="dailyLogHours" min="0" step="0.25" value="0" /></div>
              <div class="full">
                <label>Percent complete</label>
                <div class="dl-percent-row">
                  <select id="dailyLogPercentMode"><option value="manual">Manual</option><option value="auto">Auto from log history</option></select>
                  <input type="number" id="dailyLogPercent" min="0" max="100" step="0.1" value="0" />
                </div>
                <div class="dl-auto-note" id="dailyLogAutoNote">Manual progress is used until the job has enough history for an automatic trend.</div>
              </div>
              <div class="full"><label for="dailyLogWork">Work performed</label><textarea id="dailyLogWork" placeholder="Describe areas, quantities, crews, and completed activities" required></textarea></div>
              <div class="full"><label for="dailyLogIssues">Issues / delays / coordination</label><textarea id="dailyLogIssues" placeholder="Access, material, inspection, weather, RFI, safety, or schedule issues"></textarea></div>
              <div class="full"><label for="dailyLogPhotos">Photo thumbnails</label><input type="file" id="dailyLogPhotos" accept="image/*" multiple /><div class="dl-auto-note">Selected images are compressed into small base64 thumbnails before saving.</div><div class="dl-photo-preview" id="dailyLogPhotoPreview"></div></div>
              <div class="full"><label for="dailyLogPhotoPaths">Local photo paths</label><textarea id="dailyLogPhotoPaths" placeholder="One local or network file path per line"></textarea></div>
            </div>
            <button type="submit" class="primary" style="width:100%;margin-top:11px;padding:10px;font-weight:800">Save Daily Log</button>
          </form>
        </section>
        <section class="dl-pane">
          <div class="dl-pane-head"><span>Log History</span><span id="dailyLogCount">0</span></div>
          <div class="dl-list" id="dailyLogList"></div>
        </section>
      </div>`;

    const changePanel = document.getElementById('panel-change-orders');
    const estimatePanel = document.getElementById('panel-estimate');
    const panelAnchor = changePanel || estimatePanel;
    if (panelAnchor?.nextSibling) panels.insertBefore(panel, panelAnchor.nextSibling);
    else panels.appendChild(panel);

    tab.addEventListener('click', () => setTimeout(() => loadLogs(true), 0));
    panel.querySelector('#btnRefreshDailyLogs').addEventListener('click', () => loadLogs(true));
    panel.querySelector('#dailyLogForm').addEventListener('submit', saveLog);
    panel.querySelector('#dailyLogPercentMode').addEventListener('change', updatePercentMode);
    panel.querySelector('#dailyLogCrew').addEventListener('input', updatePercentMode);
    panel.querySelector('#dailyLogHours').addEventListener('input', updatePercentMode);
    panel.querySelector('#dailyLogPhotos').addEventListener('change', selectPhotos);
    panel.querySelector('#dailyLogDate').value = today();
    renderPhotoDrafts();
    return true;
  }

  function latestLog(list = logs) {
    return [...list].sort((a, b) => `${b.date || ''}|${b.created || ''}`.localeCompare(`${a.date || ''}|${a.created || ''}`))[0] || null;
  }

  function automaticPercent(crewCount, hours) {
    const ordered = [...logs].sort((a, b) => `${a.date || ''}|${a.created || ''}`.localeCompare(`${b.date || ''}|${b.created || ''}`));
    const previous = clampPercent(latestLog()?.percentComplete || diskJob?.percentComplete || 0);
    const rates = [];
    for (let index = 1; index < ordered.length; index += 1) {
      const prior = clampPercent(ordered[index - 1].percentComplete);
      const current = clampPercent(ordered[index].percentComplete);
      const crewHours = Math.max(0, number(ordered[index].crewCount) * number(ordered[index].hours));
      const delta = current - prior;
      if (delta > 0 && crewHours > 0) rates.push(delta / crewHours);
    }
    if (rates.length) {
      const average = rates.reduce((sum, value) => sum + value, 0) / rates.length;
      return clampPercent(previous + Math.max(0, number(crewCount) * number(hours)) * average);
    }
    const status = diskJob?.status || scanProject(folderPath())?.job?.status || '';
    if (status === 'Complete') return 100;
    if (status === 'Punch') return Math.max(previous, 95);
    if (status === 'In Progress') return Math.max(previous, 1);
    return previous;
  }

  function updatePercentMode() {
    const mode = document.getElementById('dailyLogPercentMode')?.value || 'manual';
    const input = document.getElementById('dailyLogPercent');
    const note = document.getElementById('dailyLogAutoNote');
    if (!input) return;
    const auto = automaticPercent(
      document.getElementById('dailyLogCrew')?.value,
      document.getElementById('dailyLogHours')?.value
    );
    input.disabled = mode === 'auto';
    if (mode === 'auto') input.value = auto.toFixed(1);
    else if (document.activeElement !== input && input.value === '') input.value = String(clampPercent(latestLog()?.percentComplete || 0));
    if (note) {
      note.textContent = mode === 'auto'
        ? 'Auto uses prior percent gain per logged crew-hour. Until a trend exists, it keeps the latest progress and applies the current job-status floor.'
        : 'Manual percent complete becomes the current progress shown on the Command Center card.';
    }
  }

  function imageThumbnail(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error(`Could not decode ${file.name}`));
        image.onload = () => {
          const maxWidth = 320;
          const maxHeight = 240;
          const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve({
            type: 'thumbnail',
            name: file.name,
            mime: 'image/jpeg',
            thumbnail: canvas.toDataURL('image/jpeg', 0.72),
          });
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function selectPhotos(event) {
    const files = [...(event.target.files || [])].slice(0, 8);
    if (!files.length) return;
    const status = document.getElementById('dailyLogFormStatus');
    if (status) status.textContent = 'Preparing photos…';
    try {
      for (const file of files) photoDrafts.push(await imageThumbnail(file));
      renderPhotoDrafts();
    } catch (error) {
      alert(error.message || error);
    } finally {
      if (status) status.textContent = 'Offline-first';
      event.target.value = '';
    }
  }

  function renderPhotoDrafts() {
    const container = document.getElementById('dailyLogPhotoPreview');
    if (!container) return;
    container.innerHTML = photoDrafts.map((photo, index) => `
      <div class="dl-photo-thumb"><img src="${esc(photo.thumbnail)}" alt="${esc(photo.name)}" /><button type="button" data-remove-photo="${index}">×</button></div>`).join('');
    container.querySelectorAll('[data-remove-photo]').forEach((button) => {
      button.addEventListener('click', () => {
        photoDrafts.splice(Number(button.dataset.removePhoto), 1);
        renderPhotoDrafts();
      });
    });
  }

  function photoPaths() {
    return String(document.getElementById('dailyLogPhotoPaths')?.value || '')
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((path) => ({ type: 'path', path, name: path.split(/[\\/]/).pop() || path }));
  }

  async function saveLog(event) {
    event.preventDefault();
    const project = currentProject();
    const path = folderPath(project);
    if (!project || !path) return alert('Open an EST job before saving a daily log.');

    const work = String(document.getElementById('dailyLogWork')?.value || '').trim();
    if (!work) return alert('Enter the work performed.');
    const mode = document.getElementById('dailyLogPercentMode')?.value === 'auto' ? 'auto' : 'manual';
    const crewCount = Math.max(0, Math.trunc(number(document.getElementById('dailyLogCrew')?.value)));
    const hours = Math.max(0, number(document.getElementById('dailyLogHours')?.value));
    const percentComplete = mode === 'auto'
      ? automaticPercent(crewCount, hours)
      : clampPercent(document.getElementById('dailyLogPercent')?.value);

    const log = {
      id: uid(),
      date: document.getElementById('dailyLogDate')?.value || today(),
      weather: String(document.getElementById('dailyLogWeather')?.value || '').trim(),
      crewCount,
      hours,
      workPerformed: work,
      percentComplete,
      percentMode: mode,
      photos: [...clone(photoDrafts), ...photoPaths()],
      issues: String(document.getElementById('dailyLogIssues')?.value || '').trim(),
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    const submit = event.submitter || event.currentTarget.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const result = await window.PTEstimates.saveDailyLog(path, log);
      logs = clone(result.dailyLogs || []);
      diskJob = clone(result.job || diskJob);
      syncScan(path, result);
      resetForm();
      render();
      decorateCommandCenter();
      window.dispatchEvent(new CustomEvent('pt:daily-log-saved', { detail: { path, log, job: clone(diskJob) } }));
      alert(`Daily log saved. Current completion: ${clampPercent(result?.summary?.percentComplete).toFixed(1)}%.`);
    } catch (error) {
      alert(`Could not save daily log: ${error.message || error}`);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function resetForm() {
    document.getElementById('dailyLogDate').value = today();
    document.getElementById('dailyLogWeather').value = '';
    document.getElementById('dailyLogCrew').value = '0';
    document.getElementById('dailyLogHours').value = '0';
    document.getElementById('dailyLogWork').value = '';
    document.getElementById('dailyLogIssues').value = '';
    document.getElementById('dailyLogPhotoPaths').value = '';
    photoDrafts = [];
    renderPhotoDrafts();
    const last = latestLog();
    document.getElementById('dailyLogPercentMode').value = 'manual';
    document.getElementById('dailyLogPercent').value = String(clampPercent(last?.percentComplete || diskJob?.percentComplete || 0));
    updatePercentMode();
  }

  async function loadLogs(force = false) {
    const project = currentProject();
    const path = folderPath(project);
    if (!path) {
      activeFolder = '';
      logs = [];
      diskJob = null;
      render();
      return;
    }
    if (!force && path === activeFolder && logs.length) return;
    if (loading) return;
    loading = true;
    activeFolder = path;
    renderMessage('Loading daily logs…');
    try {
      const scanned = scanProject(path);
      if (scanned?.daily_logs) {
        logs = clone(scanned.daily_logs);
        diskJob = clone(scanned.job || {});
      } else {
        const result = await window.PTEstimates.getProject(path);
        logs = clone(result?.daily_logs || []);
        diskJob = clone(result?.job || {});
        if (scanned) {
          scanned.daily_logs = clone(logs);
          scanned.daily_log_summary = clone(result?.daily_log_summary || {});
          scanned.job = clone(diskJob);
        }
      }
      render();
      resetForm();
    } catch (error) {
      renderMessage(error.message || String(error));
    } finally {
      loading = false;
    }
  }

  function summary() {
    const latest = latestLog();
    const count = logs.length;
    const totalCrewHours = logs.reduce((sum, log) => sum + number(log.crewCount) * number(log.hours), 0);
    const issues = logs.filter((log) => String(log.issues || '').trim()).length;
    return {
      count,
      latest,
      totalCrewHours,
      issues,
      percent: clampPercent(latest?.percentComplete || diskJob?.percentComplete || 0),
    };
  }

  function renderMessage(message) {
    const list = document.getElementById('dailyLogList');
    if (list) list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-dim)">${esc(message)}</div>`;
  }

  function render() {
    const panel = document.getElementById('panel-daily-logs');
    if (!panel) return;
    const project = currentProject();
    const list = document.getElementById('dailyLogList');
    const summaryBox = document.getElementById('dailyLogSummary');
    const count = document.getElementById('dailyLogCount');
    if (!project || !folderPath(project)) {
      if (summaryBox) summaryBox.innerHTML = '';
      if (list) list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim)">Open an EST job to add daily logs.</div>';
      return;
    }

    const values = summary();
    if (count) count.textContent = String(values.count);
    if (summaryBox) summaryBox.innerHTML = [
      ['Current Completion', `${values.percent.toFixed(1)}%`],
      ['Last Log', values.latest ? DATE.format(new Date(`${values.latest.date}T12:00:00`)) : 'No logs'],
      ['Logged Crew-Hours', values.totalCrewHours.toLocaleString('en-US', { maximumFractionDigits: 1 })],
      ['Logs With Issues', String(values.issues)],
    ].map(([label, value]) => `<div class="dl-summary-card"><div class="dl-summary-label">${esc(label)}</div><div class="dl-summary-value">${esc(value)}</div></div>`).join('');

    if (!list) return;
    const ordered = [...logs].sort((a, b) => `${b.date || ''}|${b.created || ''}`.localeCompare(`${a.date || ''}|${a.created || ''}`));
    list.innerHTML = ordered.length ? ordered.map((log) => dailyLogHtml(log)).join('') :
      '<div style="padding:24px;text-align:center;color:var(--text-dim)">No daily logs yet. Add today’s first job-site report.</div>';
  }

  function dailyLogHtml(log) {
    const photos = (log.photos || []).map((photo) => {
      if (photo.thumbnail) return `<img src="${esc(photo.thumbnail)}" alt="${esc(photo.name || 'Daily log photo')}" title="${esc(photo.name || '')}" />`;
      if (photo.path) return `<div class="dl-photo-path">${esc(photo.path)}</div>`;
      return '';
    }).join('');
    return `<article class="dl-card">
      <div class="dl-card-top">
        <div><div class="dl-card-title">${esc(DATE.format(new Date(`${log.date}T12:00:00`)))}</div><div class="dl-card-meta">${esc(log.weather || 'Weather not entered')} · ${number(log.crewCount)} crew · ${number(log.hours)} hours each · ${esc(log.percentMode || 'manual')}</div></div>
        <div class="dl-percent">${clampPercent(log.percentComplete).toFixed(1)}%</div>
      </div>
      <div class="dl-section"><div class="dl-label">Work performed</div>${esc(log.workPerformed || '—')}</div>
      ${String(log.issues || '').trim() ? `<div class="dl-section dl-issues"><div class="dl-label">Issues</div>${esc(log.issues)}</div>` : ''}
      ${photos ? `<div class="dl-section"><div class="dl-label">Photos</div><div class="dl-photos">${photos}</div></div>` : ''}
    </article>`;
  }

  function daysAgoLabel(summaryData) {
    const count = number(summaryData?.dailyLogCount);
    if (!count || !summaryData?.lastLogDate) return { text: 'Last log: No logs', stale: true };
    const todayDate = new Date(`${today()}T12:00:00`);
    const logDate = new Date(`${summaryData.lastLogDate}T12:00:00`);
    const days = Math.max(0, Math.round((todayDate - logDate) / 86400000));
    if (days === 0) return { text: 'Last log: Today', stale: false };
    if (days === 1) return { text: 'Last log: 1 day ago', stale: false };
    return { text: `Last log: ${days} days ago`, stale: days >= 3 };
  }

  function decorateCommandCenter() {
    const scan = window.PTEstimates?.lastScan?.projects || [];
    document.querySelectorAll('#commandCenterBoard .cc-card').forEach((card) => {
      const project = scan.find((item) => item.folder_path === card.dataset.path);
      const info = project?.daily_log_summary || project?.job || {};
      const label = daysAgoLabel(info);
      const percent = clampPercent(info.percentComplete || project?.job?.percentComplete || 0);
      card.querySelector('.daily-log-card-meta')?.remove();
      const client = card.querySelector('.cc-card-client');
      if (!client) return;
      client.insertAdjacentHTML('afterend', `<div class="daily-log-card-meta"><span class="${label.stale ? 'daily-log-stale' : ''}">${esc(label.text)}</span><strong>${percent.toFixed(0)}% complete</strong></div>`);
    });
  }

  function installCommandObserver() {
    const board = document.getElementById('commandCenterBoard');
    if (!board || commandObserver) return !!board;
    commandObserver = new MutationObserver(() => decorateCommandCenter());
    commandObserver.observe(board, { childList: true, subtree: true });
    decorateCommandCenter();
    return true;
  }

  function queueFirstLogPrompt(path) {
    if (promptBusy) return;
    promptBusy = true;
    setTimeout(async () => {
      try {
        const scanned = scanProject(path);
        const count = number(scanned?.daily_log_summary?.dailyLogCount || scanned?.job?.dailyLogCount);
        if (count > 0) return;
        const accepted = confirm('This job is now In Progress and has no daily logs. Create the first daily log now?');
        if (accepted) await openDailyLogs(path);
      } finally {
        promptBusy = false;
      }
    }, 150);
  }

  async function openDailyLogs(path) {
    const E = window.PTEstimates;
    let project = scanProject(path);
    if (folderPath() !== path) {
      if (!project) {
        try {
          await E.scan();
          project = scanProject(path);
        } catch (_) { /* handled below */ }
      }
      if (!project) return alert('Could not find the job in the current EST scan.');
      if (typeof E?._openBidHandler !== 'function') {
        document.querySelector('#tabBar .tab[data-tab="library"]')?.click();
        for (let index = 0; index < 40 && typeof E?._openBidHandler !== 'function'; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (typeof E?._openBidHandler !== 'function') return alert('Could not initialize the existing job opener.');
      await E._openBidHandler(project);
    }

    for (let index = 0; index < 40; index += 1) {
      const tab = document.querySelector('.tab[data-tab="daily-logs"]');
      if (tab && !tab.classList.contains('locked')) {
        tab.click();
        setTimeout(() => document.getElementById('dailyLogWork')?.focus(), 50);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    alert('The Daily Logs tab could not be opened for this job.');
  }

  function installAll() {
    captureStore();
    installStyles();
    installTab();
    installApi();
    installCommandObserver();
  }

  window.PTDailyLogs = {
    load: loadLogs,
    open: openDailyLogs,
    getLogs: () => clone(logs),
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
        logs = [];
        diskJob = null;
        photoDrafts = [];
        renderPhotoDrafts();
        if (path) loadLogs(true);
        else render();
      } else {
        decorateCommandCenter();
      }
      ticks += 1;
      if (ticks > 300 && !currentProject()) clearInterval(timer);
    }, 500);
  });

  window.addEventListener('pt:jobs-scan', () => setTimeout(decorateCommandCenter, 0));
  window.addEventListener('pt:job-finalized', () => loadLogs(true));
})();

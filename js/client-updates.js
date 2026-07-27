/**
 * One-click professional client progress updates.
 * Uses disk-backed Job, Daily Logs, Change Orders, and suite branding settings.
 */
(function () {
  'use strict';

  const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  let appState = null;
  let apiInstalled = false;
  let observer = null;
  let generatedHtml = '';
  let generatedPath = '';
  let generatedDate = '';
  let busy = false;

  function clone(value) {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  }
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const attr = esc;
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const percent = (value) => Math.max(0, Math.min(100, number(value)));
  const money = (value) => USD.format(number(value));
  const localDate = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const timestamp = (value) => {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const toast = (message, options = {}) => window.PTToast
    ? window.PTToast(message, options)
    : alert(`${options.title ? `${options.title}: ` : ''}${message}`);

  function captureStore() {
    const S = window.PTStore;
    if (!S || S.__clientUpdatesCapture) return !!S;
    S.__clientUpdatesCapture = true;
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
      S.saveState = function (state, ...args) {
        appState = state || appState;
        return original.call(this, state, ...args);
      };
    }
    return true;
  }

  function project() {
    return (appState?.projects || []).find((item) => item.id === appState.activeProjectId) || null;
  }
  function folderPath() { return String(project()?.folderPath || '').trim(); }
  function scanProject(path) {
    return (window.PTEstimates?.lastScan?.projects || []).find((item) => item.folder_path === path) || null;
  }

  function installApi() {
    const E = window.PTEstimates;
    if (!E || apiInstalled) return !!E;
    apiInstalled = true;
    E.saveClientUpdate = async function saveClientUpdate(path, html, date) {
      const response = await fetch('/api/client-update/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, html, date }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.detail || data.error || response.statusText || 'Could not save client update');
      return data;
    };
    return true;
  }

  function installStyles() {
    if (document.getElementById('clientUpdateStyles')) return;
    const style = document.createElement('style');
    style.id = 'clientUpdateStyles';
    style.textContent = `
      #generateClientUpdateButton{margin-left:8px;padding:7px 12px;border:1px solid #2563eb;border-radius:7px;background:#2563eb;color:#fff;font-weight:800;white-space:nowrap}
      #generateClientUpdateButton:disabled{opacity:.4}.cu-warn{display:inline-flex;margin-left:6px;padding:2px 7px;border-radius:999px;background:#facc15;color:#713f12;font-size:9px;font-weight:900;vertical-align:middle}
      #cuModal{position:fixed;inset:0;display:none;z-index:16000;background:#020617b8;padding:24px}#cuModal.open{display:flex;align-items:center;justify-content:center}
      .cu-shell{width:min(1080px,96vw);height:min(860px,94vh);display:flex;flex-direction:column;background:var(--bg-panel);border:1px solid var(--border);border-radius:12px;overflow:hidden}
      .cu-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--border)}.cu-actions{display:flex;gap:6px;flex-wrap:wrap}
      .cu-path{font-size:10px;color:var(--text-dim);max-width:460px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#cuFrame{flex:1;width:100%;border:0;background:#fff}`;
    document.head.appendChild(style);
  }

  function installUi() {
    const tabBar = document.getElementById('tabBar');
    if (!tabBar) return false;
    if (!document.getElementById('generateClientUpdateButton')) {
      const button = document.createElement('button');
      button.id = 'generateClientUpdateButton';
      button.type = 'button';
      button.textContent = 'Generate Client Update';
      button.title = 'Generate, save, copy, or print a professional client progress update';
      button.disabled = true;
      button.onclick = generate;
      const anchor = tabBar.querySelector('[data-tab="daily-logs"]') || tabBar.lastElementChild;
      anchor?.after(button);
    }

    if (!document.getElementById('cuModal')) {
      const modal = document.createElement('div');
      modal.id = 'cuModal';
      modal.innerHTML = `
        <section class="cu-shell" role="dialog" aria-modal="true" aria-labelledby="cuTitle">
          <header class="cu-bar">
            <div><strong id="cuTitle">Client Update Preview</strong><div id="cuPath" class="cu-path"></div></div>
            <div class="cu-actions"><button id="cuCopy">Copy Rich Text</button><button id="cuPrint">Print / Save PDF</button><button id="cuSave">Save HTML Again</button><button id="cuClose">×</button></div>
          </header><iframe id="cuFrame" title="Client update preview"></iframe>
        </section>`;
      document.body.appendChild(modal);
      modal.onclick = (event) => { if (event.target === modal) closePreview(); };
      modal.querySelector('#cuClose').onclick = closePreview;
      modal.querySelector('#cuCopy').onclick = copyRichText;
      modal.querySelector('#cuPrint').onclick = printDocument;
      modal.querySelector('#cuSave').onclick = saveAgain;
    }
    return true;
  }

  function refreshButton() {
    const button = document.getElementById('generateClientUpdateButton');
    if (button) button.disabled = !folderPath() || busy;
  }

  function collectData(result) {
    const job = result.job || {};
    const progress = percent(result.daily_log_summary?.percentComplete ?? job.percentComplete);
    const total = number(job.runningTotal || job.actualTotal || job.estimatedTotal);
    const lastUpdate = timestamp(job.lastClientUpdate);
    const logs = [...(result.daily_logs || [])]
      .sort((a, b) => `${b.date || ''}|${b.created || ''}`.localeCompare(`${a.date || ''}|${a.created || ''}`))
      .slice(0, 3);
    const approvedChanges = (result.change_orders || [])
      .filter((change) => change.status === 'Approved' && (!lastUpdate || timestamp(change.approvedAt || change.updated || change.date) > lastUpdate))
      .sort((a, b) => timestamp(b.approvedAt || b.updated || b.date) - timestamp(a.approvedAt || a.updated || a.date));
    return {
      job,
      progress,
      total,
      remaining: Math.max(0, total * (1 - progress / 100)),
      logs,
      approvedChanges,
      date: localDate(),
      branding: window.PTSettings?.get?.() || { companyName: 'WL Painting Inc.', companyLogo: '' },
    };
  }

  function paragraphs(text) {
    const value = String(text || '').trim();
    if (!value) return '<p style="color:#64748b">No details recorded.</p>';
    return value.split(/\n+/).map((line) => `<p style="margin:0 0 7px">${esc(line)}</p>`).join('');
  }

  function buildHtml(data) {
    const { job, branding } = data;
    const companyName = String(branding.companyName || 'WL Painting Inc.');
    const logo = String(branding.companyLogo || '');
    const logoHtml = logo
      ? `<img src="${attr(logo)}" alt="${attr(companyName)} logo" style="display:block;max-width:220px;max-height:78px;margin-bottom:12px;object-fit:contain;background:#fff;border-radius:6px;padding:5px" />`
      : '';
    const logsHtml = data.logs.length
      ? data.logs.map((log) => `
          <div style="border:1px solid #e2e8f0;border-radius:9px;padding:13px;margin-top:9px">
            <div style="display:flex;justify-content:space-between;gap:12px">
              <div><b>${DATE.format(new Date(`${log.date}T12:00:00`))}</b><div style="font-size:12px;color:#64748b">${esc(log.weather || 'Weather not recorded')} · ${number(log.crewCount)} crew · ${number(log.hours)} hours each</div></div>
              <b style="font-size:20px;color:#1d4ed8;white-space:nowrap">${percent(log.percentComplete).toFixed(1)}%</b>
            </div><div style="margin-top:9px;line-height:1.5">${paragraphs(log.workPerformed)}</div>
          </div>`).join('')
      : '<p style="color:#64748b">No daily logs have been entered yet.</p>';
    const changesHtml = data.approvedChanges.length
      ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Approved change</th><th align="left">Date</th><th align="right">Impact</th></tr></thead><tbody>${data.approvedChanges.map((change) => `
          <tr><td style="padding:8px 0;border-top:1px solid #e2e8f0">${esc(change.description)}</td><td style="border-top:1px solid #e2e8f0">${esc(change.date || (change.approvedAt || '').slice(0, 10))}</td><td align="right" style="border-top:1px solid #e2e8f0;font-weight:700">${money(change.totalImpact)}</td></tr>`).join('')}</tbody></table>`
      : '<p style="color:#64748b">No newly approved change orders since the previous client update.</p>';

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(job.name || 'Job')} — Client Update</title></head>
      <body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif"><main style="max-width:820px;margin:auto;padding:28px 18px">
        <section style="background:#fff;border:1px solid #dbe3ec;border-radius:14px;overflow:hidden">
          <header style="padding:24px 26px;background:#0f2742;color:#fff">${logoHtml}<div style="font-size:12px;letter-spacing:.12em;color:#bfdbfe;font-weight:700">${esc(companyName.toUpperCase())} · CLIENT PROGRESS UPDATE</div><h1 style="margin:8px 0 5px">${esc(job.name || 'Project')}</h1><div style="color:#dbeafe">${esc(job.address || 'Project address not entered')}</div><div style="display:inline-block;margin-top:13px;padding:5px 10px;border-radius:999px;background:#2563eb;font-size:12px;font-weight:700">Status: ${esc(job.status || '—')}</div></header>
          <div style="padding:24px 26px"><p>Current project update as of <b>${DATE.format(new Date(`${data.date}T12:00:00`))}</b>.</p>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0 24px"><div style="border:1px solid #dbe3ec;border-radius:9px;padding:12px"><small>COMPLETE</small><div style="font-size:23px;font-weight:800">${data.progress.toFixed(1)}%</div></div><div style="border:1px solid #dbe3ec;border-radius:9px;padding:12px"><small>CURRENT CONTRACT</small><div style="font-size:19px;font-weight:800">${money(data.total)}</div></div><div style="border:1px solid #dbe3ec;border-radius:9px;padding:12px"><small>REMAINING ESTIMATED</small><div style="font-size:19px;font-weight:800">${money(data.remaining)}</div></div></div>
            <h2 style="border-bottom:2px solid #1d4ed8;padding-bottom:6px">Recent Work and Progress</h2>${logsHtml}
            <h2 style="margin-top:25px;border-bottom:2px solid #1d4ed8;padding-bottom:6px">Approved Changes Since Last Update</h2>${changesHtml}
            <p style="margin-top:25px;padding-top:15px;border-top:1px solid #dbe3ec;color:#475569">Please contact ${esc(companyName)} with any questions regarding scheduling, access, or coordination.</p>
          </div>
        </section></main></body></html>`;
  }

  async function generate() {
    const path = folderPath();
    if (!path || busy) return;
    busy = true;
    refreshButton();
    const button = document.getElementById('generateClientUpdateButton');
    const priorText = button.textContent;
    button.textContent = 'Generating…';
    try {
      await window.PTSettings?.ready?.();
      const result = await window.PTEstimates.getProject(path);
      const data = collectData(result);
      generatedHtml = buildHtml(data);
      generatedPath = path;
      generatedDate = data.date;
      const saved = await window.PTEstimates.saveClientUpdate(path, generatedHtml, generatedDate);
      const scanned = scanProject(path);
      if (scanned) {
        scanned.job = clone(saved.job);
        scanned.client_update_summary = clone(saved.summary);
      }
      showPreview(saved.file);
      decorateCommandCenter();
      window.dispatchEvent(new CustomEvent('pt:client-update-generated', { detail: { path, file: saved.file } }));
      toast('Client update generated and saved.', { type: 'success', title: 'Client Update' });
    } catch (error) {
      toast(error.message || String(error), { type: 'error', title: 'Could not generate client update', timeout: 0 });
    } finally {
      busy = false;
      button.textContent = priorText;
      refreshButton();
    }
  }

  function showPreview(file) {
    document.getElementById('cuFrame').srcdoc = generatedHtml;
    document.getElementById('cuPath').textContent = file ? `Saved: ${file}` : '';
    document.getElementById('cuModal').classList.add('open');
  }
  function closePreview() { document.getElementById('cuModal')?.classList.remove('open'); }

  async function copyRichText() {
    if (!generatedHtml) return;
    const parsed = new DOMParser().parseFromString(generatedHtml, 'text/html');
    const rich = parsed.body.innerHTML;
    const plain = parsed.body.innerText;
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([rich], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
      } else {
        const holder = document.createElement('div');
        holder.contentEditable = 'true';
        holder.style.cssText = 'position:fixed;left:-10000px;top:0';
        holder.innerHTML = rich;
        document.body.appendChild(holder);
        const range = document.createRange();
        range.selectNodeContents(holder);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
        holder.remove();
      }
      toast('Client update copied as rich text.', { type: 'success', title: 'Clipboard' });
    } catch (error) {
      toast(error.message || String(error), { type: 'error', title: 'Copy failed' });
    }
  }

  function printDocument() {
    if (!generatedHtml) return;
    let frame = document.getElementById('cuPrintFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'cuPrintFrame';
      frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0';
      document.body.appendChild(frame);
    }
    frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); };
    frame.srcdoc = generatedHtml;
  }

  async function saveAgain() {
    if (!generatedPath || !generatedHtml) return;
    try {
      const saved = await window.PTEstimates.saveClientUpdate(generatedPath, generatedHtml, generatedDate);
      const scanned = scanProject(generatedPath);
      if (scanned) {
        scanned.job = clone(saved.job);
        scanned.client_update_summary = clone(saved.summary);
      }
      document.getElementById('cuPath').textContent = `Saved: ${saved.file}`;
      decorateCommandCenter();
      toast('Client update HTML saved.', { type: 'success', title: 'Client Update' });
    } catch (error) {
      toast(error.message || String(error), { type: 'error', title: 'Save failed' });
    }
  }

  function decorateCommandCenter() {
    const projects = window.PTEstimates?.lastScan?.projects || [];
    document.querySelectorAll('#commandCenterBoard .cc-card').forEach((card) => {
      const scanned = projects.find((item) => item.folder_path === card.dataset.path);
      const info = scanned?.client_update_summary || scanned?.job || {};
      const title = card.querySelector('.cc-card-name');
      title?.querySelector('.cu-warn')?.remove();
      if (info.clientUpdateOverdue && title) {
        title.insertAdjacentHTML('beforeend', `<span class="cu-warn" title="No client update for ${number(info.daysSinceClientUpdate)} days">Update ${number(info.daysSinceClientUpdate)}d overdue</span>`);
      }
    });
  }

  function installObserver() {
    const board = document.getElementById('commandCenterBoard');
    if (!board || observer) return !!board;
    observer = new MutationObserver(decorateCommandCenter);
    observer.observe(board, { childList: true, subtree: true });
    decorateCommandCenter();
    return true;
  }

  function installAll() {
    captureStore();
    installApi();
    installStyles();
    installUi();
    installObserver();
    refreshButton();
  }

  window.PTClientUpdates = { generate, copy: copyRichText, print: printDocument };
  captureStore();
  document.addEventListener('DOMContentLoaded', () => {
    installAll();
    let ticks = 0;
    const timer = setInterval(() => {
      installAll();
      decorateCommandCenter();
      ticks += 1;
      if (ticks > 300 && !project()) clearInterval(timer);
    }, 500);
  });
  window.addEventListener('pt:jobs-scan', () => setTimeout(decorateCommandCenter, 0));
})();

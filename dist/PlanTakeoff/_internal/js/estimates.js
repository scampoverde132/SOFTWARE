/**
 * Estimates library + folder creator (WL Painting folder conventions)
 * Requires local PlanTakeoff server (server.py) for filesystem access.
 */
(function () {
  const API = '';

  async function api(path, opts) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString();
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  window.PTEstimates = {
    online: false,
    config: null,
    lastScan: null,

    async init() {
      try {
        this.config = await api('/api/config');
        this.online = true;
        return true;
      } catch (e) {
        this.online = false;
        return false;
      }
    },

    async scan(year) {
      const q = year ? `?year=${encodeURIComponent(year)}` : '';
      this.lastScan = await api('/api/scan' + q);
      return this.lastScan;
    },

    async getProject(folderPath) {
      return api('/api/project?path=' + encodeURIComponent(folderPath));
    },

    async suggestCode(year, month) {
      let q = `?year=${year}`;
      if (month) q += `&month=${month}`;
      return api('/api/suggest-code' + q);
    },

    async createProject(payload) {
      return api('/api/create-project', { method: 'POST', body: JSON.stringify(payload) });
    },

    async createBatch(payload) {
      return api('/api/create-batch', { method: 'POST', body: JSON.stringify(payload) });
    },

    async openFolder(path) {
      return api('/api/open-folder?path=' + encodeURIComponent(path));
    },

    fileUrl(path) {
      return `/api/file?path=${encodeURIComponent(path)}`;
    },

    renderLibrary(container, projects, handlers = {}) {
      if (!projects?.length) {
        container.innerHTML =
          '<div class="empty-state"><h2>No EST folders found</h2><p>Check your Estimates year folder under Samuel Bids.</p></div>';
        return;
      }
      const rows = projects
        .map((p) => {
          const err = p.error ? ` <span class="badge" style="color:#f87171">!</span>` : '';
          const label = esc(p.folder_name || `${p.bid_ref} - ${p.project_name}`);
          return `<tr class="job-row" data-path="${esc(p.folder_path)}" title="Click to open takeoff">
            <td><strong>${esc(p.bid_ref)}</strong>${err}</td>
            <td>${label}</td>
            <td class="num">${p.drawing_count || 0}</td>
            <td>${esc((p.modified || '').slice(0, 10))}</td>
          </tr>`;
        })
        .join('');
      container.innerHTML = `
        <table class="data-grid" id="estimatesTable">
          <thead>
            <tr>
              <th>Job #</th>
              <th>Folder / Project</th>
              <th class="num">Dwgs</th>
              <th>Modified</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="panel-sub" style="padding:8px 4px">Click a row to open — first plan shows right away; other drawings load in the background.</p>`;

      container.querySelectorAll('tr[data-path]').forEach((tr) => {
        const path = tr.getAttribute('data-path');
        const proj = projects.find((x) => x.folder_path === path);
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          e.preventDefault();
          if (!proj) {
            console.warn('No project for path', path);
            return;
          }
          if (typeof handlers.onOpenBid === 'function') {
            Promise.resolve(handlers.onOpenBid(proj)).catch((err) => {
              console.error(err);
              alert('Open job failed: ' + (err.message || err));
            });
          }
        });
      });
    },
  };
})();

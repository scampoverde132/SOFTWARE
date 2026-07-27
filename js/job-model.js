/**
 * PlanTakeoff disk-backed Job model and Estimates Library status UI.
 * job.json remains additive; EST folders remain the source of truth.
 */
(function () {
  'use strict';

  const STATUSES = [
    'Lead',
    'Estimating',
    'Bid Sent',
    'Awarded',
    'In Progress',
    'Punch',
    'Complete',
    'Lost',
  ];

  const STATUS_COLORS = {
    Lead: ['#64748b', '#f8fafc'],
    Estimating: ['#2563eb', '#eff6ff'],
    'Bid Sent': ['#7c3aed', '#f5f3ff'],
    Awarded: ['#059669', '#ecfdf5'],
    'In Progress': ['#d97706', '#fffbeb'],
    Punch: ['#ea580c', '#fff7ed'],
    Complete: ['#15803d', '#f0fdf4'],
    Lost: ['#b91c1c', '#fef2f2'],
  };

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function now() {
    return new Date().toISOString().slice(0, 19);
  }

  function fallbackId(path) {
    let hash = 2166136261;
    for (const char of String(path || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `job_${(hash >>> 0).toString(16)}`;
  }

  function createJob(overrides = {}) {
    const path = String(overrides.path || overrides.folder_path || '');
    return normalizeJob({
      id: fallbackId(path),
      name: overrides.name || overrides.project_name || overrides.folder_name || 'Untitled Job',
      path,
      status: 'Lead',
      created: now(),
      updated: now(),
      notes: '',
      clientName: '',
      address: '',
      estimatedTotal: 0,
      actualTotal: 0,
      ...overrides,
    });
  }

  function normalizeJob(job = {}, project = {}) {
    const path = String(job.path || project.folder_path || '');
    const status = STATUSES.includes(job.status) ? job.status : 'Lead';
    return {
      ...job,
      id: String(job.id || fallbackId(path)),
      name: String(job.name || project.project_name || project.folder_name || 'Untitled Job'),
      path,
      status,
      created: String(job.created || project.modified || now()),
      updated: String(job.updated || project.modified || now()),
      notes: String(job.notes || ''),
      clientName: String(job.clientName || ''),
      address: String(job.address || ''),
      estimatedTotal: Number(job.estimatedTotal) || 0,
      actualTotal: Number(job.actualTotal) || 0,
    };
  }

  function badge(status) {
    const safe = STATUSES.includes(status) ? status : 'Lead';
    const colors = STATUS_COLORS[safe] || STATUS_COLORS.Lead;
    return `<span class="job-status-badge" data-status="${esc(safe)}" style="display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700;background:${colors[0]};color:${colors[1]};white-space:nowrap">${esc(safe)}</span>`;
  }

  function statusOptions(selected) {
    return STATUSES.map((status) =>
      `<option value="${esc(status)}"${status === selected ? ' selected' : ''}>${esc(status)}</option>`
    ).join('');
  }

  function installStatusFilter() {
    const textFilter = document.getElementById('libraryFilter');
    const group = textFilter?.closest('.group');
    if (!textFilter || !group || document.getElementById('libraryStatusFilter')) return !!textFilter;

    const label = document.createElement('label');
    label.className = 'small';
    label.textContent = 'Status';
    const select = document.createElement('select');
    select.id = 'libraryStatusFilter';
    select.style.minWidth = '135px';
    select.innerHTML = `<option value="">All statuses</option>${statusOptions('')}`;
    select.addEventListener('change', () => {
      // Reuse app.js's existing filter listener and libraryProjects source.
      textFilter.dispatchEvent(new Event('input', { bubbles: true }));
    });
    group.append(label, select);
    return true;
  }

  function patchEstimates() {
    const E = window.PTEstimates;
    if (!E || E.__jobModelInstalled) return !!E;
    E.__jobModelInstalled = true;
    E.JOB_STATUSES = STATUSES;

    E.updateJob = async function updateJob(path, updates = {}) {
      const res = await fetch('/api/job/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ...updates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText || 'Could not update job');
      return data.job;
    };

    E.renderLibrary = function renderLibraryWithJobs(container, projects, handlers = {}) {
      installStatusFilter();
      const wantedStatus = document.getElementById('libraryStatusFilter')?.value || '';
      const list = (projects || [])
        .map((project) => {
          project.job = normalizeJob(project.job, project);
          return project;
        })
        .filter((project) => !wantedStatus || project.job.status === wantedStatus);

      if (!list.length) {
        container.innerHTML = '<div class="empty-state"><h2>No matching EST folders</h2><p>Adjust the text or status filter.</p></div>';
        return;
      }

      const rows = list.map((project) => {
        const job = project.job;
        const err = project.error ? ' <span class="badge" style="color:#f87171">!</span>' : '';
        const label = esc(project.folder_name || `${project.bid_ref} - ${project.project_name}`);
        return `<tr class="job-row" data-path="${esc(project.folder_path)}" title="${esc(job.notes || 'Click to open takeoff')}">
          <td><strong>${esc(project.bid_ref)}</strong>${err}</td>
          <td>${label}</td>
          <td>${badge(job.status)}</td>
          <td><select class="job-status-select" aria-label="Change ${esc(project.bid_ref)} status">${statusOptions(job.status)}</select></td>
          <td class="num">${project.drawing_count || 0}</td>
          <td>${esc((job.updated || project.modified || '').slice(0, 10))}</td>
        </tr>`;
      }).join('');

      container.innerHTML = `
        <table class="data-grid" id="estimatesTable">
          <thead><tr><th>Job #</th><th>Folder / Project</th><th>Status</th><th>Change status</th><th class="num">Dwgs</th><th>Updated</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="panel-sub" style="padding:8px 4px">Click a row to open. Use the dropdown—or right-click a row—to change its disk-backed job status.</p>`;

      container.querySelectorAll('tr[data-path]').forEach((row) => {
        const path = row.dataset.path;
        const project = list.find((item) => item.folder_path === path);
        const select = row.querySelector('.job-status-select');
        row.style.cursor = 'pointer';

        row.addEventListener('click', (event) => {
          if (event.target.closest('select, option, button, a')) return;
          if (project && typeof handlers.onOpenBid === 'function') {
            Promise.resolve(handlers.onOpenBid(project)).catch((error) => {
              console.error(error);
              alert(`Open job failed: ${error.message || error}`);
            });
          }
        });

        row.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          select?.focus();
          if (typeof select?.showPicker === 'function') {
            try { select.showPicker(); } catch (_) { select.click(); }
          } else {
            select?.click();
          }
        });

        select?.addEventListener('click', (event) => event.stopPropagation());
        select?.addEventListener('change', async (event) => {
          event.stopPropagation();
          if (!project) return;
          const previous = project.job.status;
          const next = event.target.value;
          event.target.disabled = true;
          try {
            project.job = normalizeJob(await E.updateJob(project.folder_path, {
              status: next,
              notes: project.job.notes,
            }), project);
            const cell = row.children[2];
            if (cell) cell.innerHTML = badge(project.job.status);
            row.title = project.job.notes || 'Click to open takeoff';
            if (wantedStatus && project.job.status !== wantedStatus) {
              document.getElementById('libraryFilter')?.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } catch (error) {
            event.target.value = previous;
            alert(`Status update failed: ${error.message || error}`);
          } finally {
            event.target.disabled = false;
          }
        });
      });
    };
    return true;
  }

  window.PTJobs = {
    STATUSES,
    STATUS_COLORS,
    createJob,
    normalizeJob,
  };

  patchEstimates();
  document.addEventListener('DOMContentLoaded', () => {
    installStatusFilter();
    patchEstimates();
    let tries = 0;
    const timer = setInterval(() => {
      installStatusFilter();
      patchEstimates();
      tries += 1;
      if (tries >= 40 || (window.PTEstimates?.__jobModelInstalled && document.getElementById('libraryStatusFilter'))) {
        clearInterval(timer);
      }
    }, 100);
  });
})();

(() => {
  const tbody = document.getElementById('jobs-tbody');
  const table = document.getElementById('jobs-table');
  const emptyState = document.getElementById('empty-state');
  const countLabel = document.getElementById('count-label');
  const clearAllBtn = document.getElementById('clear-all');

  function getTs(val) {
    if (!val) return 0;
    return typeof val === 'object' ? (val.ts || 0) : Number(val);
  }

  function formatDate(val) {
    const ts = getTs(val);
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  function getTitle(val) {
    if (typeof val === 'object' && val.title) return val.title;
    return '';
  }

  function getCompany(val) {
    if (typeof val === 'object' && val.company) return val.company;
    return '';
  }

  function getUrl(val, jobId) {
    if (typeof val === 'object' && val.url) return val.url;
    return 'https://www.linkedin.com/jobs/view/' + jobId;
  }

  function renderRow(jobId, val) {
    const tr = document.createElement('tr');
    tr.dataset.jobId = jobId;

    const title = getTitle(val) || 'Job #' + jobId;
    const company = getCompany(val);
    const url = getUrl(val, jobId);
    const dateStr = formatDate(val);

    tr.innerHTML = `
      <td><a href="${url}" target="_blank" rel="noopener noreferrer">${escHtml(title)}</a></td>
      <td>${escHtml(company) || '<span class="muted">—</span>'}</td>
      <td>${escHtml(dateStr)}</td>
      <td><button class="remove-btn danger-button-sm" data-id="${escAttr(jobId)}" type="button">Remove</button></td>
    `;
    return tr;
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function escAttr(str) {
    return String(str || '').replace(/"/g, '&quot;');
  }

  async function load() {
    const { appliedJobs = {} } = await chrome.storage.local.get('appliedJobs');
    render(appliedJobs);
  }

  function render(appliedJobs) {
    tbody.innerHTML = '';
    const entries = Object.entries(appliedJobs)
      .sort((a, b) => getTs(b[1]) - getTs(a[1]));

    const count = entries.length;
    countLabel.textContent = count === 0 ? '' : count === 1 ? '1 job tracked.' : count + ' jobs tracked.';

    if (count === 0) {
      table.classList.add('hidden');
      emptyState.classList.remove('hidden');
      clearAllBtn.disabled = true;
      return;
    }

    table.classList.remove('hidden');
    emptyState.classList.add('hidden');
    clearAllBtn.disabled = false;

    entries.forEach(([jobId, val]) => {
      tbody.appendChild(renderRow(jobId, val));
    });
  }

  // Remove single entry
  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.remove-btn');
    if (!btn) return;
    const jobId = btn.dataset.id;
    const { appliedJobs = {} } = await chrome.storage.local.get('appliedJobs');
    delete appliedJobs[jobId];
    await chrome.storage.local.set({ appliedJobs });
    render(appliedJobs);
  });

  // Clear all
  clearAllBtn.addEventListener('click', async () => {
    if (!confirm('Remove all tracked applied jobs? This cannot be undone.')) return;
    await chrome.storage.local.set({ appliedJobs: {} });
    render({});
  });

  // Live updates when storage changes (e.g. from content script)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.appliedJobs) {
      render(changes.appliedJobs.newValue || {});
    }
  });

  void load();
})();

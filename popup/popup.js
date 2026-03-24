const DEFAULT_SETTINGS = {
  hideApplied: true,
  hideDismissed: true,
  hidePromoted: true,
  hideViewed: false,
  hideKeywords: true,
  hideOldJobs: false,
  hoursThreshold: 24,
  blockedKeywords: []
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  status: null,
  suggestions: []
};

const elements = {
  statusMessage: document.getElementById('status-message'),
  lastRefreshed: document.getElementById('last-refreshed'),
  reloadHint: document.getElementById('reload-hint'),
  reloadTabBtn: document.getElementById('reload-tab-btn'),
  statHidden: document.getElementById('stat-hidden'),
  statScanned: document.getElementById('stat-scanned'),
  statVisible: document.getElementById('stat-visible'),
  statHours: document.getElementById('stat-hours'),
  reasonApplied: document.getElementById('reason-applied'),
  reasonDismissed: document.getElementById('reason-dismissed'),
  reasonPromoted: document.getElementById('reason-promoted'),
  reasonViewed: document.getElementById('reason-viewed'),
  reasonKeywords: document.getElementById('reason-keywords'),
  reasonAppliedTracked: document.getElementById('reason-applied-tracked'),
  hideApplied: document.getElementById('hide-applied'),
  hideDismissed: document.getElementById('hide-dismissed'),
  hidePromoted: document.getElementById('hide-promoted'),
  hideViewed: document.getElementById('hide-viewed'),
  hideKeywords: document.getElementById('hide-keywords'),
  hideOldJobs: document.getElementById('hide-old-jobs'),
  hoursThreshold: document.getElementById('hours-threshold'),
  keywordInput: document.getElementById('keyword-input'),
  keywordList: document.getElementById('keyword-list'),
  keywordSuggestions: document.getElementById('keyword-suggestions'),
  refreshStatus: document.getElementById('refresh-status'),
  addKeyword: document.getElementById('add-keyword'),
  scanKeywords: document.getElementById('scan-keywords'),
  clearViewed: document.getElementById('clear-viewed'),
  clearDismissed: document.getElementById('clear-dismissed'),
  clearApplied: document.getElementById('clear-applied'),
  syncAppliedJobs: document.getElementById('sync-applied-jobs'),
  viewAppliedJobs: document.getElementById('view-applied-jobs'),
  appliedCount: document.getElementById('applied-count'),
  resetSettings: document.getElementById('reset-settings'),
  openHelp: document.getElementById('open-help')
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendTabMessage(type, payload = {}, timeoutMs = 8000) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  try {
    const msgPromise = chrome.tabs.sendMessage(tab.id, { type, ...payload });
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    return await Promise.race([msgPromise, timeoutPromise]);
  } catch (_) {
    return null;
  }
}

function normalizeKeyword(keyword) {
  return keyword.trim().toLowerCase();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    blockedKeywords: Array.isArray(stored.blockedKeywords) ? stored.blockedKeywords : []
  };
}

function renderChipList(container, entries, removeHandler, emptyText) {
  container.textContent = '';
  if (entries.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted small';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = entry;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'x';
    btn.title = `Remove ${entry}`;
    btn.addEventListener('click', () => void removeHandler(entry));
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

function renderSettings() {
  elements.hideApplied.checked = state.settings.hideApplied;
  elements.hideDismissed.checked = state.settings.hideDismissed;
  elements.hidePromoted.checked = state.settings.hidePromoted;
  elements.hideViewed.checked = state.settings.hideViewed;
  elements.hideKeywords.checked = state.settings.hideKeywords;
  elements.hideOldJobs.checked = state.settings.hideOldJobs;
  elements.hoursThreshold.value = String(state.settings.hoursThreshold || 24);
  renderChipList(elements.keywordList, state.settings.blockedKeywords, removeBlockedKeyword, 'No blocked keywords yet.');
}

function renderSuggestions() {
  elements.keywordSuggestions.textContent = '';
  if (state.suggestions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted small';
    empty.textContent = 'No suggestions yet. Click "Scan page" to analyse current cards.';
    elements.keywordSuggestions.appendChild(empty);
    return;
  }
  state.suggestions.forEach((item) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${item.keyword} (${item.count})`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'block';
    btn.addEventListener('click', () => void addBlockedKeyword(item.keyword));
    chip.appendChild(btn);
    elements.keywordSuggestions.appendChild(chip);
  });
}

function renderStatus() {
  const counts = state.status?.counts || {};
  const supportedPage = Boolean(state.status?.supportedPage);

  elements.statusMessage.textContent = supportedPage
    ? `Connected to ${state.status.activeUrl}`
    : 'Open a LinkedIn Jobs page (jobs/search or jobs/collections) in the active tab.';

  elements.statHidden.textContent = String(counts.totalHidden || 0);
  elements.statScanned.textContent = String(counts.scannedCards || 0);
  elements.statVisible.textContent = String(counts.visibleCards || 0);
  elements.statHours.textContent = String(counts.hours || 0);
  elements.reasonApplied.textContent = String(counts.applied || 0);
  elements.reasonDismissed.textContent = String(counts.dismissed || 0);
  elements.reasonPromoted.textContent = String(counts.promoted || 0);
  elements.reasonViewed.textContent = String(counts.viewed || 0);
  elements.reasonKeywords.textContent = String(counts.keywords || 0);
  elements.reasonAppliedTracked.textContent = String(counts.appliedTracked || 0);
  if (elements.appliedCount) elements.appliedCount.textContent = String(counts.appliedTracked || 0);
}

async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await chrome.storage.local.set(patch);
  await sendTabMessage('FORCE_REAPPLY');
  await refreshStatus();
}

async function addBlockedKeyword(raw) {
  const tokens = raw.split(',').map(normalizeKeyword).filter(Boolean);
  if (tokens.length === 0) return;
  const next = [...new Set([...state.settings.blockedKeywords, ...tokens])].sort((a, b) => a.localeCompare(b));
  await updateSettings({ blockedKeywords: next });
  elements.keywordInput.value = '';
  renderSettings();
}

async function removeBlockedKeyword(kw) {
  const next = state.settings.blockedKeywords.filter((e) => e !== kw);
  await updateSettings({ blockedKeywords: next });
  renderSettings();
}

async function reloadActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return false;
  await chrome.tabs.reload(tab.id);
  return true;
}

async function tryReinjectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content.css']
    });
    // Give the freshly injected script a moment to initialise
    await new Promise((r) => setTimeout(r, 600));
    return true;
  } catch (_) {
    return false;
  }
}

async function refreshStatus() {
  const btn = elements.refreshStatus;
  btn.disabled = true;
  btn.textContent = '⏳ Refreshing…';
  btn.style.background = '';
  btn.style.color = '';
  // Keep ⏳ visible for at least 500ms so users always see feedback
  const minSpinnerMs = 500;
  const spinStart = Date.now();

  try {
    // Use 2s timeout — fast enough that failure is obvious, not a frozen popup
    let reapplyResult = await sendTabMessage('FORCE_REAPPLY', {}, 2000);

    if (!reapplyResult?.ok) {
      // Content script unreachable — try to re-inject it automatically
      const tab = await getActiveTab();
      const isLinkedIn = tab?.url?.includes('linkedin.com/jobs');
      if (isLinkedIn && tab?.id) {
        btn.textContent = '🔄 Injecting script…';
        const injected = await tryReinjectContentScript(tab.id);
        if (injected) {
          reapplyResult = await sendTabMessage('FORCE_REAPPLY', {}, 3000);
        }
      }
    }

    // Ensure minimum spinner time is met before showing result
    const elapsed = Date.now() - spinStart;
    if (elapsed < minSpinnerMs) {
      await new Promise((r) => setTimeout(r, minSpinnerMs - elapsed));
    }

    if (!reapplyResult?.ok) {
      const tab = await getActiveTab();
      const isLinkedIn = tab?.url?.includes('linkedin.com/jobs');
      // Show failure permanently — do NOT auto-hide so user can read it
      btn.textContent = '⚠ Failed — click to retry';
      btn.style.background = '#c0392b';
      btn.style.color = '#fff';
      btn.style.fontWeight = '700';
      const lastEl = document.getElementById('last-refreshed');
      if (lastEl) {
        lastEl.textContent = '⚠ Filter script unreachable. Reload the LinkedIn tab below.';
        lastEl.style.color = '#c0392b';
        lastEl.style.fontWeight = '600';
      }
      if (isLinkedIn) {
        elements.statusMessage.textContent =
          '⚠ Filter script not running. Reload the LinkedIn tab, then click Re-apply Filters again.';
        if (elements.reloadHint) elements.reloadHint.style.display = 'block';
      } else {
        elements.statusMessage.textContent =
          'Open https://www.linkedin.com/jobs/search in the active tab.';
      }
      return;
    }

    // Success — clear any previous failure state
    if (elements.reloadHint) elements.reloadHint.style.display = 'none';

    // Use counts from the FORCE_REAPPLY response directly (avoids a second round-trip
    // that could fail and make it look like nothing happened)
    const freshCounts = reapplyResult.counts || {};
    if (!state.status) state.status = {};
    state.status.counts = freshCounts;
    state.status.supportedPage = true;
    renderStatus();

    // Flash each stat tile so user clearly sees the update
    document.querySelectorAll('#stats-grid > div').forEach((tile) => {
      tile.classList.remove('stats-flash');
      void tile.offsetWidth;
      tile.classList.add('stats-flash');
      setTimeout(() => tile.classList.remove('stats-flash'), 900);
    });

    // Update timestamp — make it prominent (green, bold) then fade
    const lastEl = document.getElementById('last-refreshed');
    if (lastEl) {
      const now = new Date();
      const hidden = freshCounts.totalHidden ?? 0;
      const visible = freshCounts.visibleCards ?? 0;
      lastEl.textContent = `✓ ${hidden} hidden · ${visible} visible · refreshed ${now.toLocaleTimeString()}`;
      lastEl.style.color = '#16a34a';
      lastEl.style.fontWeight = '600';
      lastEl.classList.remove('refreshed-pulse');
      void lastEl.offsetWidth;
      lastEl.classList.add('refreshed-pulse');
      // After animation fades, reset inline styles so CSS class takes over
      setTimeout(() => {
        lastEl.style.color = '';
        lastEl.style.fontWeight = '';
      }, 3500);
    }

    const hidden = freshCounts.totalHidden ?? 0;
    const visible = freshCounts.visibleCards ?? 0;
    const scanned = freshCounts.scannedCards ?? 0;
    btn.textContent = `✓ Done — ${hidden} hidden, ${visible} visible`;
    btn.style.background = '#27ae60';
    btn.style.color = '#fff';
    btn.style.fontWeight = '700';
    // Keep green for 15s so user cannot miss it
    setTimeout(() => {
      btn.textContent = 'Re-apply Filters';
      btn.style.background = '';
      btn.style.color = '';
      btn.style.fontWeight = '';
    }, 15000);
  } finally {
    btn.disabled = false;
  }
}

async function handleKeywordScan() {
  const response = await sendTabMessage('SCAN_KEYWORDS');
  state.suggestions = response?.suggestions || [];
  renderSuggestions();
}

async function clearViewedHistory() {
  await chrome.storage.local.set({ viewedJobs: {} });
  await sendTabMessage('CLEAR_VIEWED_HISTORY');
  await refreshStatus();
}

async function clearDismissedHistory() {
  await chrome.storage.local.set({ dismissedJobs: {} });
  await sendTabMessage('CLEAR_DISMISSED_HISTORY');
  await refreshStatus();
}

async function clearAppliedHistory() {
  await chrome.storage.local.set({ appliedJobs: {} });
  await sendTabMessage('CLEAR_APPLIED_HISTORY');
  await refreshStatus();
}

async function openAppliedJobsPage() {
  await chrome.tabs.create({ url: 'https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED' });
}

async function openViewerPage() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('pages/applied-jobs.html') });
}

async function resetAllSettings() {
  state.settings = { ...DEFAULT_SETTINGS };
  state.suggestions = [];
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  await sendTabMessage('FORCE_REAPPLY');
  renderSettings();
  renderSuggestions();
  await refreshStatus();
}

function bindEvents() {
  elements.refreshStatus.addEventListener('click', () => void refreshStatus());

  // Inline "Reload LinkedIn tab" button shown when content script is unreachable
  if (elements.reloadTabBtn) {
    elements.reloadTabBtn.addEventListener('click', async () => {
      elements.reloadTabBtn.textContent = 'Reloading…';
      await reloadActiveTab();
      setTimeout(() => window.close(), 600);
    });
  }

  elements.addKeyword.addEventListener('click', () => void addBlockedKeyword(elements.keywordInput.value));
  elements.keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void addBlockedKeyword(elements.keywordInput.value); }
  });

  elements.scanKeywords.addEventListener('click', () => void handleKeywordScan());
  elements.clearViewed.addEventListener('click', () => void clearViewedHistory());
  elements.clearDismissed.addEventListener('click', () => void clearDismissedHistory());
  elements.clearApplied.addEventListener('click', () => void clearAppliedHistory());
  elements.syncAppliedJobs.addEventListener('click', () => void openAppliedJobsPage());
  elements.viewAppliedJobs.addEventListener('click', () => void openViewerPage());
  elements.resetSettings.addEventListener('click', () => void resetAllSettings());
  elements.openHelp.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' }));

  elements.hideApplied.addEventListener('change', () => void updateSettings({ hideApplied: elements.hideApplied.checked }));
  elements.hideDismissed.addEventListener('change', () => void updateSettings({ hideDismissed: elements.hideDismissed.checked }));
  elements.hidePromoted.addEventListener('change', () => void updateSettings({ hidePromoted: elements.hidePromoted.checked }));
  elements.hideViewed.addEventListener('change', () => void updateSettings({ hideViewed: elements.hideViewed.checked }));
  elements.hideKeywords.addEventListener('change', () => void updateSettings({ hideKeywords: elements.hideKeywords.checked }));
  elements.hideOldJobs.addEventListener('change', () => void updateSettings({ hideOldJobs: elements.hideOldJobs.checked }));
  elements.hoursThreshold.addEventListener('change', () => {
    const v = Math.max(1, Number(elements.hoursThreshold.value || 24));
    elements.hoursThreshold.value = String(v);
    void updateSettings({ hoursThreshold: v });
  });
}

async function initialize() {
  await loadSettings();
  renderSettings();
  renderSuggestions();
  bindEvents();
  // Show applied count from storage immediately, refresh from page after
  const { appliedJobs = {} } = await chrome.storage.local.get('appliedJobs');
  if (elements.appliedCount) elements.appliedCount.textContent = String(Object.keys(appliedJobs).length);
  await refreshStatus();
}

void initialize();

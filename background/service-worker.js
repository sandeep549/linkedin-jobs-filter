const DEFAULT_SETTINGS = {
  hideApplied: true,
  hideDismissed: true,
  hidePromoted: true,
  hideViewed: false,
  hideKeywords: true,
  hideOldJobs: false,
  hoursThreshold: 24,
  blockedKeywords: [],
  showOnlyActivelyReviewing: false,
  showOnlyEarlyApplicant: false,
  viewedJobs: {},
  dismissedJobs: {},
  appliedJobs: {}
};

async function ensureDefaults() {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      missing[key] = value;
    }
  }
  if (Object.keys(missing).length > 0) {
    await chrome.storage.local.set(missing);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === 'FILTER_COUNTS_UPDATE') {
    const tabId = sender.tab?.id;
    const total = Number(message.counts?.totalHidden || 0);
    if (tabId !== undefined) {
      chrome.action.setBadgeBackgroundColor({ tabId, color: total > 0 ? '#0a66c2' : '#6b7280' });
      chrome.action.setBadgeText({ tabId, text: total > 0 ? String(Math.min(total, 999)) : '' });
      chrome.action.setTitle({
        tabId,
        title: total > 0
          ? `LinkedIn Jobs Filter: ${total} job${total === 1 ? '' : 's'} hidden`
          : 'LinkedIn Jobs Filter'
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'OPEN_OPTIONS_PAGE') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

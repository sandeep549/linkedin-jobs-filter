(() => {
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
    showOnlyEarlyApplicant: false
  };

  const HISTORY_LIMIT = 2000;
  const STOPWORDS = new Set([
    'a', 'an', 'and', 'apply', 'applicants', 'as', 'at', 'be', 'by', 'company', 'days', 'for',
    'from', 'full', 'hours', 'in', 'is', 'job', 'jobs', 'level', 'linkedin', 'minutes', 'months',
    'of', 'on', 'or', 'posted', 'remote', 'role', 'roles', 'search', 'seconds', 'seniority',
    'the', 'this', 'time', 'to', 'type', 'via', 'weeks', 'with', 'work', 'years'
  ]);

  let settings = { ...DEFAULT_SETTINGS };
  let viewedJobs = {};
  let dismissedJobs = {};
  let appliedJobs = {};
  let counts = emptyCounts();
  let lastUrl = location.href;
  let scanTimer = null;
  let observer = null;

  // Extension context guard — prevents errors after extension reload/update
  function isContextValid() {
    try { return Boolean(chrome.runtime?.id); } catch (_) { return false; }
  }

  // Page detection

  function isJobsPage() {
    if (location.hostname !== 'www.linkedin.com') return false;
    const p = location.pathname;
    return p.startsWith('/jobs/search') || p.startsWith('/jobs/collections') || p.startsWith('/jobs/search-results');
  }

  function isAppliedJobsPage() {
    return (
      location.hostname === 'www.linkedin.com' &&
      location.pathname.startsWith('/my-items') &&
      location.search.includes('APPLIED')
    );
  }

  // Helpers

  function emptyCounts() {
    return {
      totalHidden: 0, applied: 0, dismissed: 0, promoted: 0, viewed: 0,
      keywords: 0, hours: 0, showOnly: 0, scannedCards: 0, visibleCards: 0,
      appliedTracked: 0, lastUpdatedAt: null
    };
  }

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function tokenize(value) {
    return normalizeText(value)
      .split(/[^a-z0-9+#.-]+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  }

  function debounceApply() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      if (isJobsPage()) void applyFilters();
    }, 120);
  }

  function stopExtension() {
    // Called when the extension context is invalidated (e.g. after reload).
    // Disconnect the DOM observer and stop all timers so we leave no zombies.
    try { if (observer) { observer.disconnect(); observer = null; } } catch (_) { /* */ }
    window.clearTimeout(scanTimer);
  }

  function getStorageKeys() {
    return [...Object.keys(DEFAULT_SETTINGS), 'viewedJobs', 'dismissedJobs', 'appliedJobs'];
  }

  // Storage

  async function loadState() {
    try {
      const stored = await chrome.storage.local.get(getStorageKeys());
      settings = {
        ...DEFAULT_SETTINGS,
        ...stored,
        blockedKeywords: Array.isArray(stored.blockedKeywords) ? stored.blockedKeywords : []
      };
      viewedJobs = stored.viewedJobs && typeof stored.viewedJobs === 'object' ? stored.viewedJobs : {};
      dismissedJobs = stored.dismissedJobs && typeof stored.dismissedJobs === 'object' ? stored.dismissedJobs : {};
      appliedJobs = stored.appliedJobs && typeof stored.appliedJobs === 'object' ? stored.appliedJobs : {};
    } catch (err) {
      if (String(err).includes('Extension context invalidated')) stopExtension();
    }
  }

  // appliedJobs entries: { ts, title, company, url } OR legacy plain number
  function getAppliedTs(val) {
    if (!val) return 0;
    return typeof val === 'object' ? (val.ts || 0) : Number(val);
  }

  function makeAppliedEntry(card, jobId) {
    const titleEl = card && card.querySelector(
      '.job-card-list__title, .job-card-container__link strong, strong, .jobs-unified-top-card__job-title'
    );
    const companyEl = card && card.querySelector(
      '.artdeco-entity-lockup__subtitle, .job-card-container__company-name, .job-card-container__primary-description'
    );
    return {
      ts: Date.now(),
      title: titleEl ? (titleEl.textContent || '').trim() : '',
      company: companyEl ? (companyEl.textContent || '').trim() : '',
      url: jobId ? 'https://www.linkedin.com/jobs/view/' + jobId : ''
    };
  }

  function pruneHistory(record) {
    return Object.fromEntries(
      Object.entries(record)
        .sort((a, b) => getAppliedTs(b[1]) - getAppliedTs(a[1]))
        .slice(0, HISTORY_LIMIT)
    );
  }

  async function persistHistory(key, record) {
    const pruned = pruneHistory(record);
    if (key === 'viewedJobs') viewedJobs = pruned;
    else if (key === 'dismissedJobs') dismissedJobs = pruned;
    else if (key === 'appliedJobs') appliedJobs = pruned;
    try {
      await chrome.storage.local.set({ [key]: pruned });
    } catch (err) {
      if (String(err).includes('Extension context invalidated')) stopExtension();
    }
  }

  // DOM helpers

  function getPreferredCardTarget(node) {
    return (
      node.closest('[data-occludable-job-id]') ||
      node.closest('li.jobs-search-results__list-item') ||
      node.closest('li.jobs-search-results-list__list-item') ||
      node.closest('.jobs-search-results__list-item') ||
      node.closest('.jobs-search-results-list__list-item') ||
      node.closest('.job-card-container') ||
      node.closest('[data-job-id]') ||
      node.closest('[data-component-type=LazyColumn]') ||
      node.closest('li') ||
      node
    );
  }

  function isLikelyJobCard(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.closest('.jobs-search__job-details, .jobs-details, .jobs-box')) return false;
    if (node.querySelector('a[href*="/jobs/view/"]')) return true;
    if (node.querySelector('a[href*="currentJobId="]')) return true;
    const className = typeof node.className === 'string' ? node.className : '';
    return node.hasAttribute('data-occludable-job-id') || className.includes('job-card');
  }

  function getJobCards() {
    const cards = new Set();
    // Broad selectors covering /jobs/search, /jobs/search-results, /jobs/collections,
    // and the QUALIFICATION_LANDING page (/jobs/search-results?origin=QUALIFICATION_LANDING).
    // [data-occludable-job-id]                    — standard attribute on all regular job cards
    // .job-card-container                         — inner card component (search + collections)
    // li.jobs-search-results__list-item           — search-specific list item class
    // li.jobs-search-results-list__list-item      — search-results variant (extra 'list' segment)
    // li.jobs-job-board-list__item                — collections-specific list item class
    // li.scaffold-layout__list-item               — fallback used on some collection views
    // [data-component-type=LazyColumn]            — qualification landing page (one per job card)
    // a[href*="/jobs/view/"]                       — last-resort: find any job link
    document.querySelectorAll(
      '[data-occludable-job-id], .job-card-container, li.jobs-search-results__list-item, li.jobs-search-results-list__list-item, li.jobs-job-board-list__item, li.scaffold-layout__list-item, [data-component-type=LazyColumn], a[href*="/jobs/view/"]'
    ).forEach((candidate) => {
      if (!(candidate instanceof HTMLElement)) return;
      const target = getPreferredCardTarget(candidate);
      if (isLikelyJobCard(target)) cards.add(target);
    });
    return [...cards];
  }

  function getJobId(card) {
    const dataId = card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id');
    if (dataId) return dataId;
    const anchor = card.querySelector('a[href*="/jobs/view/"]');
    if (anchor && anchor.href) {
      const match = anchor.href.match(/\/jobs\/view\/(\d+)/);
      if (match) return match[1];
    }
    // Fallback for qualification landing page: job ID is in currentJobId query param
    const navAnchor = card.querySelector('a[href*="currentJobId="]');
    if (navAnchor && navAnchor.href) {
      try {
        const id = new URL(navAnchor.href).searchParams.get('currentJobId');
        if (id) return id;
      } catch (_) {}
    }
    return null;
  }

  function getJobIdFromUrl(url) {
    try {
      const params = new URL(url).searchParams;
      return params.get('currentJobId') || null;
    } catch (_) {
      return null;
    }
  }

  function getCardText(card) {
    // Clone the card so we can strip our own injected elements before reading text.
    // Without this, our "Mark Applied" / "Dismiss" buttons would make every card
    // match hasAppliedLabel() / hasDismissedLabel() etc.
    const clone = card.cloneNode(true);
    clone.querySelectorAll('[class^="hj-"], [id^="hj-"]').forEach((el) => el.remove());
    return normalizeText(clone.innerText || clone.textContent || '');
  }

  function containsWord(text, word) {
    return new RegExp(
      '(^|[^a-z])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i'
    ).test(text);
  }

  function hasAppliedLabel(text) { return containsWord(text, 'applied'); }
  function hasPromotedLabel(text) { return containsWord(text, 'promoted'); }
  function hasViewedLabel(text) { return containsWord(text, 'viewed'); }
  function hasDismissedLabel(text) {
    return /we won(?:'|')t show you this job again|dismissed/.test(text);
  }
  function hasActivelyReviewingLabel(text) {
    // LinkedIn renders this badge with several phrasings depending on locale/version:
    // "Actively reviewing applicants", "Actively reviewing", "actively reviewing"
    return text.includes('actively reviewing') || text.includes('actively hiring');
  }
  function hasEarlyApplicantLabel(text) {
    return text.includes('early applicant');
  }

  function matchesBlockedKeyword(text) {
    if (!settings.hideKeywords || settings.blockedKeywords.length === 0) return false;
    return settings.blockedKeywords.some((kw) => text.includes(normalizeText(kw)));
  }

  function extractAgeHours(card) {
    const text = getCardText(card);
    const match = text.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
    if (!match) return null;
    const amount = Number(match[1]);
    const multipliers = { minute: 1/60, hour: 1, day: 24, week: 168, month: 720, year: 8760 };
    return amount * multipliers[match[2]];
  }

  // Filter evaluation

  function evaluateCard(card) {
    const jobId = getJobId(card);
    const text = getCardText(card);
    const reasons = [];

    if (settings.hideApplied && (appliedJobs[jobId] || hasAppliedLabel(text))) reasons.push('applied');
    if (settings.hideDismissed && (dismissedJobs[jobId] || hasDismissedLabel(text))) reasons.push('dismissed');
    if (settings.hidePromoted && hasPromotedLabel(text)) reasons.push('promoted');
    if (settings.hideViewed && (viewedJobs[jobId] || hasViewedLabel(text))) reasons.push('viewed');
    if (matchesBlockedKeyword(text)) reasons.push('keywords');

    if (settings.hideOldJobs) {
      const ageHours = extractAgeHours(card);
      if (ageHours !== null && ageHours > Number(settings.hoursThreshold || 0)) reasons.push('hours');
    }

    // Show-only filters — evaluated only on cards that passed all hide filters above.
    // OR semantics: a card is visible if it matches ANY enabled show-only criterion.
    // Use card.textContent directly to capture text in CSS-hidden badge spans.
    if (reasons.length === 0) {
      const anyShowOnlyActive = settings.showOnlyActivelyReviewing || settings.showOnlyEarlyApplicant;
      if (anyShowOnlyActive) {
        const rawText = normalizeText(card.textContent || '');
        const matchesAny =
          (settings.showOnlyActivelyReviewing && hasActivelyReviewingLabel(rawText)) ||
          (settings.showOnlyEarlyApplicant    && hasEarlyApplicantLabel(rawText));
        if (!matchesAny) reasons.push('showOnly');
      }
    }

    return { jobId, reasons, text };
  }

  function updateCardVisibility(card, reasons, jobId) {
    card.classList.add('hj-filter-target');
    card.dataset.hjReasons = reasons.join(',');
    if (reasons.length > 0) {
      card.classList.add('hj-hidden-job');
      card.classList.remove('hj-applied-highlight');
    } else {
      card.classList.remove('hj-hidden-job');
      // Highlight applied cards when not hidden
      const isAppliedCard = jobId && appliedJobs[jobId];
      if (!settings.hideApplied && isAppliedCard) {
        card.classList.add('hj-applied-highlight');
      } else {
        card.classList.remove('hj-applied-highlight');
      }
    }
  }

  function ensureActionButtons(card) {
    if (card.querySelector('.hj-dismiss-button')) return;
    const anchor = card.querySelector('a[href*="/jobs/view/"]');
    if (!anchor) return;

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'hj-dismiss-button';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.title = 'Hide this job locally';
    dismissBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const jobId = getJobId(card);
      if (!jobId) return;
      dismissedJobs[jobId] = Date.now();
      void persistHistory('dismissedJobs', dismissedJobs).then(() => debounceApply());
    });

    card.appendChild(dismissBtn);
  }

  async function sendCountsToBackground() {
    if (!isContextValid()) return;
    try {
      counts.appliedTracked = Object.keys(appliedJobs).length;
      await chrome.runtime.sendMessage({ type: 'FILTER_COUNTS_UPDATE', counts });
    } catch (_) {}
  }

  // Brief inset outline flash on visible cards so user sees filters re-ran
  function pulseCards() {
    getJobCards()
      .filter((c) => !c.classList.contains('hj-hidden-job'))
      .forEach((card) => {
        card.classList.remove('hj-refresh-pulse');
        void card.offsetWidth;
        card.classList.add('hj-refresh-pulse');
        setTimeout(() => card.classList.remove('hj-refresh-pulse'), 700);
      });
  }

  async function applyFilters() {
    if (!isJobsPage()) return;
    const nextCounts = emptyCounts();
    const cards = getJobCards();
    nextCounts.scannedCards = cards.length;

    const appliedToStore = {};

    cards.forEach((card) => {
      ensureActionButtons(card);
      const { jobId, reasons, text } = evaluateCard(card);

      // Layer A: persist applied badge immediately on detection
      if (jobId && hasAppliedLabel(text) && !appliedJobs[jobId]) {
        appliedToStore[jobId] = makeAppliedEntry(card, jobId);
      }

      updateCardVisibility(card, reasons, jobId);
      if (reasons.length === 0) {
        nextCounts.visibleCards += 1;
      } else {
        nextCounts.totalHidden += 1;
        reasons.forEach((r) => { nextCounts[r] = (nextCounts[r] || 0) + 1; });
      }
    });

    if (Object.keys(appliedToStore).length > 0) {
      Object.assign(appliedJobs, appliedToStore);
      void persistHistory('appliedJobs', appliedJobs);
    }

    nextCounts.appliedTracked = Object.keys(appliedJobs).length;
    nextCounts.lastUpdatedAt = new Date().toISOString();
    counts = nextCounts;
    await sendCountsToBackground();
  }

  // Keyword suggestions

  function buildKeywordSuggestions() {
    const freq = new Map();
    getJobCards().forEach((card) => {
      const title = card.querySelector('strong, .job-card-list__title, .job-card-container__link')?.textContent || '';
      const company = card.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__company-name')?.textContent || '';
      tokenize(title + ' ' + company).forEach((token) => {
        if (!settings.blockedKeywords.includes(token)) {
          freq.set(token, (freq.get(token) || 0) + 1);
        }
      });
    });
    return [...freq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([keyword, count]) => ({ keyword, count }));
  }

  // Viewed job tracking

  async function markViewedFromEventTarget(eventTarget) {
    const anchor = eventTarget.closest && eventTarget.closest('a[href*="/jobs/view/"]');
    const card = anchor ? getPreferredCardTarget(anchor) : getPreferredCardTarget(eventTarget);
    if (!card || !isLikelyJobCard(card)) return;
    const jobId = getJobId(card);
    if (!jobId || viewedJobs[jobId]) return;
    viewedJobs[jobId] = Date.now();
    await persistHistory('viewedJobs', viewedJobs);
    debounceApply();
  }

  // Layer C: LinkedIn native "Did you apply?" modal intercept

  function watchLinkedInApplyConfirm() {
    const seenModals = new WeakSet();

    const modalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          const candidates = [];
          if (node.getAttribute('role') === 'dialog' || node.getAttribute('role') === 'alertdialog') {
            candidates.push(node);
          }
          node.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => candidates.push(el));

          for (const candidate of candidates) {
            if (seenModals.has(candidate)) continue;
            const text = normalizeText(candidate.textContent || '');
            if (!text.includes('did you apply') && !text.includes('have you applied')) continue;

            seenModals.add(candidate);

            const buttons = Array.from(candidate.querySelectorAll('button'));
            const yesBtn = buttons.find((btn) => {
              const t = normalizeText(btn.textContent || '');
              return t === 'yes' || t.includes('i applied') || t.includes('yes, i applied') || t === 'applied';
            });

            if (!yesBtn) continue;

            yesBtn.addEventListener('click', () => {
              const jobId = getJobIdFromUrl(location.href);
              if (!jobId) return;
              // Try to find the active card for metadata
              const activeCard = document.querySelector(
                `li[data-occludable-job-id="${jobId}"], [data-job-id="${jobId}"]`
              ) || Array.from(getJobCards()).find((c) => getJobId(c) === jobId) || null;
              appliedJobs[jobId] = makeAppliedEntry(activeCard, jobId);
              void persistHistory('appliedJobs', appliedJobs).then(() => {
                if (isJobsPage()) debounceApply();
              });
            }, { once: true });
          }
        }
      }
    });

    modalObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Layer 1: Sync from LinkedIn Applied Jobs page

  let syncStatusEl = null;

  function showSyncStatus(msg) {
    if (!syncStatusEl) {
      syncStatusEl = document.createElement('div');
      syncStatusEl.id = 'hj-sync-badge';
      syncStatusEl.style.cssText = [
        'position:fixed', 'bottom:20px', 'right:20px', 'z-index:99999',
        'background:#0a66c2', 'color:#fff', 'padding:8px 14px',
        'border-radius:6px', 'font-size:13px', 'font-family:sans-serif',
        'box-shadow:0 2px 8px rgba(0,0,0,0.25)', 'pointer-events:none'
      ].join(';');
      document.body.appendChild(syncStatusEl);
    }
    syncStatusEl.textContent = msg;
    syncStatusEl.style.display = 'block';
  }

  function hideSyncStatus() {
    if (syncStatusEl) syncStatusEl.style.display = 'none';
  }

  let scrollObserver = null;

  async function syncAppliedFromPage() {
    showSyncStatus('LinkedIn Jobs Filter: scanning applied jobs\u2026');

    let newCount = 0;
    const now = Date.now();

    document.querySelectorAll('a[href*="/jobs/view/"]').forEach((anchor) => {
      const match = anchor.href.match(/\/jobs\/view\/(\d+)/);
      if (!match) return;
      const id = match[1];
      if (appliedJobs[id]) return;

      // Walk up to find card-level title/company
      const card = anchor.closest('li') || anchor.closest('div[data-job-id]') || null;
      const titleEl = card && card.querySelector(
        '.job-card-list__title, strong, .artdeco-entity-lockup__title'
      );
      const companyEl = card && card.querySelector(
        '.artdeco-entity-lockup__subtitle, .job-card-container__company-name'
      );
      appliedJobs[id] = {
        ts: now,
        title: titleEl ? (titleEl.textContent || '').trim() : '',
        company: companyEl ? (companyEl.textContent || '').trim() : '',
        url: 'https://www.linkedin.com/jobs/view/' + id
      };
      newCount += 1;
    });

    if (newCount > 0) {
      await persistHistory('appliedJobs', appliedJobs);
    }

    const total = Object.keys(appliedJobs).length;
    const label = total === 1 ? 'job' : 'jobs';
    showSyncStatus('LinkedIn Jobs Filter: synced ' + total + ' applied ' + label + ' (' + newCount + ' new)');
    setTimeout(hideSyncStatus, 4000);

    // Watch for infinite scroll loading more job cards
    if (!scrollObserver) {
      let syncDebounce = null;
      scrollObserver = new MutationObserver(() => {
        clearTimeout(syncDebounce);
        syncDebounce = setTimeout(() => { void syncAppliedFromPage(); }, 600);
      });
      scrollObserver.observe(document.body, { childList: true, subtree: true });
      // Disconnect after 3 minutes
      setTimeout(() => {
        if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
      }, 180000);
    }
  }

  // Detail pane "✓ Applied" banner

  let lastDetailJobId = null;

  function updateDetailBanner() {
    const jobId = getJobIdFromUrl(location.href);
    if (jobId === lastDetailJobId) return;
    lastDetailJobId = jobId;

    // Remove any existing banner first
    const old = document.getElementById('hj-applied-banner');
    if (old) old.remove();

    if (!jobId || !appliedJobs[jobId]) return;

    const pane = document.querySelector(
      '.jobs-search__job-details--container, .jobs-search__job-details, .jobs-details, [data-job-id] .jobs-unified-top-card'
    );
    if (!pane) return;

    const banner = document.createElement('div');
    banner.id = 'hj-applied-banner';
    banner.textContent = '\u2713 You\u2019ve applied to this job';
    pane.prepend(banner);
  }

  function watchDetailPaneBanner() {
    // React to route changes and DOM mutations that swap the detail pane
    setInterval(updateDetailBanner, 600);
  }

  // Watchers (job search page only)

  function watchClicks() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.hj-dismiss-button')) return;
      void markViewedFromEventTarget(target);
    }, true);
  }

  function watchRouteChanges() {
    window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        debounceApply();
      }
    }, 500);
  }

  function watchDomChanges() {
    observer = new MutationObserver(() => { debounceApply(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
  }

  // Message listener

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isContextValid()) return false;
    if (!message || !message.type) return false;

    if (message.type === 'GET_STATUS') {
      sendResponse({
        ok: true,
        supportedPage: isJobsPage(),
        isAppliedJobsPage: isAppliedJobsPage(),
        counts: Object.assign({}, counts, { appliedTracked: Object.keys(appliedJobs).length }),
        settings,
        activeUrl: location.href
      });
      return false;
    }

    if (message.type === 'SCAN_KEYWORDS') {
      sendResponse({ ok: true, suggestions: buildKeywordSuggestions() });
      return false;
    }

    if (message.type === 'CLEAR_VIEWED_HISTORY') {
      void persistHistory('viewedJobs', {}).then(() => {
        debounceApply();
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === 'CLEAR_DISMISSED_HISTORY') {
      void persistHistory('dismissedJobs', {}).then(() => {
        debounceApply();
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === 'CLEAR_APPLIED_HISTORY') {
      void persistHistory('appliedJobs', {}).then(() => {
        debounceApply();
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === 'FORCE_REAPPLY') {
      applyFilters()
        .then(() => {
          pulseCards();
          sendResponse({ ok: true, counts: counts });
        })
        .catch((err) => { sendResponse({ ok: false, error: String(err) }); });
      return true;
    }

    if (message.type === 'SYNC_APPLIED_JOBS') {
      if (isAppliedJobsPage()) {
        void syncAppliedFromPage().then(() => sendResponse({ ok: true }));
      } else {
        sendResponse({ ok: false, reason: 'Not on Applied Jobs page' });
      }
      return true;
    }

    return false;
  });

  // Storage change listener

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    let shouldApply = false;

    for (const key in changes) {
      const change = changes[key];
      if (key in DEFAULT_SETTINGS) {
        settings[key] = change.newValue;
        shouldApply = true;
      }
      if (key === 'viewedJobs') { viewedJobs = change.newValue || {}; shouldApply = true; }
      if (key === 'dismissedJobs') { dismissedJobs = change.newValue || {}; shouldApply = true; }
      if (key === 'appliedJobs') { appliedJobs = change.newValue || {}; shouldApply = true; }
    }

    if (shouldApply && isJobsPage()) debounceApply();
  });

  // Init

  async function initialize() {
    await loadState();

    if (isAppliedJobsPage()) {
      void syncAppliedFromPage();
      return;
    }

    if (isJobsPage()) {
      watchClicks();
      watchRouteChanges();
      watchDomChanges();
      watchLinkedInApplyConfirm();
      watchDetailPaneBanner();
      await applyFilters();
    }
  }

  void initialize();
})();

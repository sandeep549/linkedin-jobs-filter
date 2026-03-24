# Copilot Instructions — LinkedIn Jobs Filter Chrome Extension

## Project overview

This is a **zero-build Manifest V3 Chrome extension** that filters LinkedIn Jobs pages locally.
No bundler, no npm, no build step. All files are plain JavaScript (ES2020+), HTML, and CSS.
Load the folder directly in Chrome via `chrome://extensions` → **Load unpacked**.

---

## Architecture

```
manifest.json            MV3 manifest — defines permissions, host_permissions, content_scripts
background/
  service-worker.js      MV3 service worker: badge management, message routing
content/
  content.js             IIFE injected into LinkedIn pages — all filter logic lives here
  content.css            Styles injected alongside content.js
popup/
  popup.html / .js / .css  Extension popup UI and its logic
pages/
  applied-jobs.html/.js/.css  Local viewer page for tracked applied jobs
options/
  options.html / .css    Help & Support page
```

---

## Key design rules

1. **No build tools.** Never add webpack, rollup, esbuild, TypeScript compilation, or any npm scripts. If you need a new file, write it in plain ES2020 JavaScript.

2. **No external network requests from the extension itself.** All data is stored in `chrome.storage.local`. No fetch calls to external APIs. The only network access is the host permission granted to `linkedin.com` so the content script can run.

3. **All content-script code is in a single IIFE** (`content/content.js`). Do not split it into modules — MV3 content scripts in this project are loaded as plain scripts, not ES modules.

4. **CSS class prefix.** All classes and IDs injected into the LinkedIn DOM by this extension must be prefixed with `hj-` (e.g. `hj-dismiss-button`, `hj-hidden-job`). This prefix is used by `getCardText()` to strip injected elements from the card text clone before text analysis. Breaking this convention causes false-positive filter matches.

5. **`getCardText()` strips injected elements first.** When reading card text for filter evaluation, the function clones the card, removes all `[class^="hj-"]` and `[id^="hj-"]` elements, then reads `innerText || textContent`. Always ensure injected buttons/badges use an `hj-` class so they are excluded from text matching.

6. **`ensureActionButtons()` is called before `evaluateCard()` in `applyFilters()`.** Injected buttons use `hj-*` classes so they are stripped in the clone before evaluation. Maintain this ordering.

7. **`appliedJobs` auto-detection (Layer A) is aggressive.** The word `applied` appearing anywhere in a card's visible text (from LinkedIn's own UI, e.g. "X people applied") will write that job ID to storage permanently. If you modify text matching, be conservative to avoid false positives that pollute storage.

8. **SPA navigation handling.** LinkedIn is a React SPA. The content script watches URL changes via `setInterval` + `MutationObserver` to re-run filters after client-side navigation. Do not use `DOMContentLoaded` alone.

9. **Extension context guard.** All async chrome API calls are wrapped in `isContextValid()` checks or try/catch for `"Extension context invalidated"`. Always maintain this pattern when adding new message handlers or storage calls.

10. **Supported URL patterns** (must match `manifest.json` host_permissions and content_scripts matches):
    - `https://www.linkedin.com/jobs/search*`
    - `https://www.linkedin.com/jobs/collections*`
    - `https://www.linkedin.com/my-items/*` (Applied Jobs sync page)

---

## Storage schema (`chrome.storage.local`)

| Key | Type | Description |
|---|---|---|
| `hideApplied` | boolean | Filter toggle |
| `hideDismissed` | boolean | Filter toggle |
| `hidePromoted` | boolean | Filter toggle |
| `hideViewed` | boolean | Filter toggle |
| `hideKeywords` | boolean | Keyword filter toggle |
| `hideOldJobs` | boolean | Age filter toggle |
| `hoursThreshold` | number | Age cutoff in hours |
| `blockedKeywords` | string[] | List of blocked keyword strings (lowercased) |
| `viewedJobs` | `{ [jobId]: timestamp }` | Locally tracked viewed jobs |
| `dismissedJobs` | `{ [jobId]: timestamp }` | Locally dismissed jobs |
| `appliedJobs` | `{ [jobId]: { ts, title, company, url } }` | Applied job records |

Maximum 2 000 entries per history object (pruned by recency).

---

## Message passing (popup ↔ content script)

| Message type | Direction | Purpose |
|---|---|---|
| `FORCE_REAPPLY` | popup → content | Re-run all filters; returns `{ ok, counts }` |
| `SCAN_KEYWORDS` | popup → content | Returns keyword suggestions from visible cards |
| `CLEAR_VIEWED_HISTORY` | popup → content | Resets in-memory viewedJobs |
| `CLEAR_DISMISSED_HISTORY` | popup → content | Resets in-memory dismissedJobs |
| `CLEAR_APPLIED_HISTORY` | popup → content | Resets in-memory appliedJobs |
| `FILTER_COUNTS_UPDATE` | content → background | Updates badge count |
| `OPEN_OPTIONS_PAGE` | popup → background | Opens options page |

---

## Common pitfalls to avoid

- **Do not add `"include_keywords"` or detail-scan features back.** This feature was removed because LinkedIn's SPA detail pane cannot be reliably scraped from a content script — the pane may not have loaded when the scan runs. If re-implementing, use a background fetch approach instead.
- **Do not use `document.querySelectorAll` with very broad selectors without scoping to `.jobs-search-results__list`.** LinkedIn renders many non-job elements that match generic selectors like `li`.
- **Do not reload the tab automatically** from the popup except when the user explicitly clicks "Reload LinkedIn tab". Auto-reload is disruptive.
- **Do not store large blobs in `chrome.storage.local`.** The quota is 10 MB. History is pruned to 2 000 entries.
- **Always test on both `/jobs/search` and `/jobs/collections`.** The card DOM structure differs slightly between these two page types.

---

## Testing the extension manually

1. Make your changes (no build needed).
2. Go to `chrome://extensions`, find **LinkedIn Jobs Filter**, click the ↺ refresh icon.
3. Reload the LinkedIn tab.
4. Open the popup and click **Re-apply Filters** to force a fresh run.
5. Check the Hidden/Scanned/Visible counts.
6. Open DevTools → Console on the LinkedIn tab for content script errors.
7. Open DevTools → Service Worker console (from `chrome://extensions` → Inspect views) for background script errors.

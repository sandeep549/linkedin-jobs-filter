# LinkedIn Jobs Filter

A zero-build Chrome extension (Manifest V3) that filters LinkedIn Jobs results locally — no server, no tracking, no data leaves your browser.

Works on:
- `https://www.linkedin.com/jobs/search*`
- `https://www.linkedin.com/jobs/collections*`

---

## Features

| Feature | Description |
|---|---|
| **Hide Applied Jobs** | Hides cards LinkedIn marks as "Applied" plus any jobs you've manually or automatically marked via the extension |
| **Hide Dismissed Jobs** | Hides jobs you've dismissed via the injected **Dismiss** button |
| **Hide Promoted Jobs** | Hides cards LinkedIn labels as "Promoted" |
| **Hide Viewed Jobs** | Hides jobs you've already clicked on (tracked locally) |
| **Hide Jobs by Keywords** | Hides cards whose title/company/card text contains any blocked keyword |
| **Hide jobs older than N hours** | Hides cards based on the age text LinkedIn shows (e.g. `3 hours ago`, `2 days ago`) |
| **Keyword Scanner** | Analyses visible job titles & companies and suggests keywords to block |
| **View Applied Jobs** | Opens a local page listing all jobs the extension has recorded as applied |
| **Sync Applied Jobs** | Opens your LinkedIn Applied Jobs page so the extension can import all previously applied job IDs |
| **Mark Applied button** | Injected on every card — lets you manually flag external-apply jobs as applied |
| **Dismiss button** | Injected on every card — locally dismisses a job without using LinkedIn's own dismiss |

All data is stored in `chrome.storage.local`. Nothing is sent anywhere.

---

## Install locally (no build step required)

1. Clone or download this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the root folder of this repo (the one containing `manifest.json`).
5. Pin the **LinkedIn Jobs Filter** extension from the extensions toolbar.
6. Navigate to `https://www.linkedin.com/jobs/search` or any `/jobs/collections` page.
7. Click the extension icon to open the popup.

> **After any code change:** go to `chrome://extensions` and click the ↺ refresh icon on the extension tile, then reload your LinkedIn tab.

---

## Popup controls

### Filters section
All checkboxes save immediately and re-apply filters to the current page.

### Keyword Scanner
- Type one or more keywords (comma-separated) and press **Enter** or click **Add** to block them.
- Click **Scan page** to analyse visible card titles/companies and see frequency-ranked suggestions.
- Click **block** on a suggestion chip to add it to the block list.

### Local data section
| Button | What it does |
|---|---|
| **View Applied Jobs** | Opens `pages/applied-jobs.html` — a table of all locally tracked applied jobs |
| **Sync Applied Jobs** | Opens `linkedin.com/my-items/saved-jobs/?cardType=APPLIED` — scroll through it so the extension auto-imports those job IDs |
| **Clear viewed history** | Wipes the local `viewedJobs` record |
| **Clear dismissed jobs** | Wipes the local `dismissedJobs` record |
| **Clear applied history** | Wipes the local `appliedJobs` record — use this if jobs are being incorrectly marked as applied |
| **Reset all settings** | Restores all defaults and clears keyword list |

### Re-apply Filters button
Forces the content script to re-scan all visible cards and update the stats. Also auto-reinjects the content script if it was lost after an extension reload.

---

## How "Applied" detection works (3 layers)

1. **LinkedIn badge text** — if a card's visible text contains the word `applied` as a whole word (case-insensitive), the job is flagged.
2. **Manual "Mark Applied" button** — clicking the injected button on any card records the job ID in local storage.
3. **Sync from LinkedIn Applied Jobs page** — when you visit your LinkedIn Applied Jobs page, the extension scrapes visible job links and saves their IDs.

> ⚠ **Troubleshooting false positives:** If every job appears as already applied, click **Clear applied history** in the popup to wipe the stored list. This is usually caused by a one-time mis-detection that wrote many job IDs to storage.

---

## How "Viewed" tracking works

The content script listens for clicks on job card links and records each job ID in `viewedJobs` storage. Refreshing the page does not clear viewed history — use **Clear viewed history** in the popup.

---

## How "Dismissed" tracking works

Each visible card gets an injected **Dismiss** button. Clicking it writes the job ID to `dismissedJobs` and immediately hides the card. Use **Clear dismissed jobs** to restore them.

---

## Age filter

The filter parses text like `3 hours ago`, `2 days ago`, `1 week ago` from the card. If LinkedIn does not expose age text on a card, that card is never hidden by the age filter.

Conversion used: 1 minute = 1/60 h · 1 day = 24 h · 1 week = 168 h · 1 month = 720 h · 1 year = 8 760 h.

---

## Supported URLs

```
https://www.linkedin.com/jobs/search*
https://www.linkedin.com/jobs/collections*
https://www.linkedin.com/my-items/*        (for Applied Jobs sync)
```

---

## Project structure

```
manifest.json          MV3 manifest
background/
  service-worker.js    Badge + message router
content/
  content.js           Main filter logic injected into LinkedIn pages
  content.css          Styles for hidden cards, highlights, injected buttons
popup/
  popup.html           Extension popup UI
  popup.js             Popup logic (settings, stats, keyword management)
  popup.css            Popup styles
pages/
  applied-jobs.html    Local "Applied Jobs" viewer page
  applied-jobs.js      Renders the applied jobs table from storage
  applied-jobs.css     Styles for the viewer page
options/
  options.html         Help & Support page (opened from popup)
  options.css
```

---

## Known limitations

- LinkedIn is a Single Page Application. The DOM changes frequently. If LinkedIn updates its markup, selectors in `content.js` may need updating.
- The extension does **not** use LinkedIn's API — it reads the DOM only.
- The age filter depends on LinkedIn rendering age text on the card (not all card types do).

---

## License

MIT

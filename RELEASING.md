# How to Release a New Version

Follow these steps every time you want to ship a new version of **LinkedIn Jobs Filter**.

---

## 1. Make your code changes

Edit files in the repo as needed. All source lives in:
```
manifest.json
background/
content/
popup/
options/
pages/
icons/
```

---

## 2. Bump the version number

Edit **`manifest.json`** — change the `"version"` field:
```json
"version": "1.1.0"
```

Use [Semantic Versioning](https://semver.org/):
- `1.0.x` — bug fixes only
- `1.x.0` — new features, backwards compatible
- `x.0.0` — breaking changes / major redesign

---

## 3. Test locally

1. Go to `chrome://extensions`
2. Click **↺** (reload) on the LinkedIn Jobs Filter tile
3. Reload your LinkedIn Jobs tab
4. Smoke-test all filter checkboxes and any changed features

---

## 4. Commit the changes

```bash
cd /Users/sandeepkumar/repo/temp

git add -A
git commit -m "Release v1.1.0 — <short description of changes>"
git push origin main
```

---

## 5. Build the release zip

The zip must contain the extension root (with `manifest.json` at the top level), with no hidden/test files.

```bash
cd /Users/sandeepkumar/repo/temp

VERSION=$(node -p "require('./manifest.json').version")

zip -r "linkedin-jobs-filter-v${VERSION}.zip" \
  manifest.json \
  background/ \
  content/ \
  popup/ \
  options/ \
  pages/ \
  icons/ \
  README.md \
  PRIVACY_POLICY.md \
  --exclude "*.DS_Store" \
  --exclude "*.chrome-test-profile*"

echo "Created linkedin-jobs-filter-v${VERSION}.zip"
```

---

## 6. Create a GitHub Release

```bash
VERSION=$(node -p "require('./manifest.json').version")

gh release create "v${VERSION}" \
  "linkedin-jobs-filter-v${VERSION}.zip" \
  --title "v${VERSION}" \
  --notes "## What's new in v${VERSION}

- <describe changes here>

## Install
Download \`linkedin-jobs-filter-v${VERSION}.zip\`, unzip it, then load the folder as an unpacked extension in Chrome (see README for full steps)."
```

This creates a tagged release on GitHub with the zip attached — users can download it directly from the Releases page.

---

## 7. (Optional) Submit to Chrome Web Store

When you're ready to pay the one-time \$5 developer fee:

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click **Add new item**
3. Upload `linkedin-jobs-filter-vX.X.X.zip`
4. Fill in the store listing (see `STORE_LISTING.md` for prepared copy)
5. Upload screenshots and the promo tile (440×280 px)
6. Submit for review (usually 1–3 business days)

---

## Quick reference

| Task | Command |
|---|---|
| Get current version | `node -p "require('./manifest.json').version"` |
| List all releases | `gh release list` |
| View a release | `gh release view v1.0.0` |
| Delete a release | `gh release delete v1.0.0` |

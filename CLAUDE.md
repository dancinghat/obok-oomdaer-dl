# CLAUDE.md

## Project Overview

Chrome extension (Manifest V3) that downloads purchased e-books from books.com.tw as EPUB or Kobo KEPUB files.

## Commands

```bash
npm run build   # bump patch version, then production build → dist/
npm run dev     # vite build --watch (no version bump, for development iteration)
```

After any build, reload the extension in Chrome at `chrome://extensions` for changes to take effect.

## Architecture

### Entry Points

| File | Role |
|---|---|
| `src/background.js` | MV3 service worker — handles all message actions, manages download queue |
| `src/popup/App.jsx` | React popup UI |
| `popup.html` | Popup shell HTML |

### Source Map

```
src/
  api.js          — All HTTP calls to books.com.tw (getCmsToken, deviceReg, getBookDownloadInfo, fetchFile, getReadList)
  background.js   — Message router + download queue processor
  downloader.js   — Full download pipeline: auth → device reg → fetch files → decrypt → package
  epub.js         — Zip/EPUB assembler
  kepub.js        — Kobo KEPUB converter (transforms EPUB → KEPUB format)
  parser.js       — XML parsers for container.xml and content.opf
  crypto/
    crypto.js     — XOR decryption + image checksum
    md5.js        — MD5 implementation
  popup/
    App.jsx       — Full popup UI (book list, download controls, settings panel)
    App.css       — Popup styles
    main.jsx      — React mount point
```

### Message Protocol (popup → background)

| Action | Payload | Response |
|---|---|---|
| `getReadList` | `{ offset }` | `{ data }` or `{ error }` |
| `startDownload` | `{ bookId, format }` | `{ status: 'queued' }` |
| `cancelAll` | — | `{ status: 'cancelled' }` |
| `getSettings` | — | `{ settings }` |
| `saveSettings` | `{ settings }` | `{ status: 'ok' }` |

Background pushes back: `progress`, `error`, `queueUpdate`, `cancelledAll`.

### Download Flow

1. `background.js` receives `startDownload`, pushes to in-memory queue
2. `downloadBook()` in `downloader.js` runs:
   - `getCmsToken()` → read `CmsToken` cookie
   - `deviceReg()` → register fake device
   - `getBookDownloadInfo()` → get `download_link`, `download_token`, `encrypt_type`
   - Fetch each file listed in `content.opf`, XOR-decrypt, assemble into EPUB zip
3. Chrome downloads the result as a base64 data URL (object URLs unavailable in MV3 service workers)

### Book List Loading

`getReadList` in `background.js` uses `chrome.scripting.executeScript` to run a `fetch` inside an open books.com.tw tab (with `credentials: 'include'`). This is required because Chrome MV3 strips certain headers from service worker cross-origin requests, and the fetch needs to run from the viewer page's origin for correct CORS/cookie behaviour.

**The tab must be open at `https://viewer-ebook.books.com.tw/...` (or any `*.books.com.tw` page) for the book list to load.**

The popup has a 15-second timeout on this call — if no response arrives within 15 s, it shows an error rather than hanging indefinitely.

## Build System

- **Bundler**: Vite 6 + `@vitejs/plugin-react`
- `base: './'` — required so Chrome extension paths are relative
- Two entry points: `popup` (React app) and `background` (service worker, kept as named `background.js`)
- `public/` is copied as-is to `dist/` — icons and `manifest.json` live here

### Version Bump

`npm run build` runs `scripts/bump-version.js` first (`prebuild` hook), which increments the patch version in both `package.json` and `public/manifest.json`. The built `dist/manifest.json` therefore always carries the bumped version.

`npm run dev` does NOT bump the version.

## Key Constraints

- **MV3 service workers can be killed at any time.** Keep-alive is managed by Chrome while processing a message; after ~5 min or when idle, the worker is terminated. Avoid long-running synchronous work.
- **`URL.createObjectURL` is unavailable in MV3 service workers.** Downloads use `data:` URLs with base64 encoding instead.
- **Cookie header stripping**: Service workers cannot freely set `Cookie` on cross-origin requests. The `executeScript` injection approach works around this for the book list fetch.
- **Download delay**: Each file request has a configurable delay (default 1000 ms). Values below 300 ms risk triggering rate limiting.

## Icons

Source: `public/icons/icon.svg`  
Generated PNGs (via `sips`): `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`

To regenerate after changing the SVG:
```bash
for size in 16 32 48 128; do
  sips -s format png public/icons/icon.svg --resampleHeightWidth $size $size --out "public/icons/icon-${size}.png"
done
```

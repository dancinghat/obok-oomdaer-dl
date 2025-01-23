import { parseContentOpf } from './parser.js';
import { buildEpub } from './epub.js';
import { convertToKepub } from './kepub.js';

const READMOO_BEARER = 'TWBLXfuP-NbtCrjD2PAiFA';

// Only run in the outer reader frame, never in the nested EPUB content iframe.
// Both are at reader.readmoo.com, but the content iframe is under /ebook/, not /reader/.
const IS_READER_FRAME = () =>
  location.hostname === 'reader.readmoo.com' && location.pathname.startsWith('/reader/');

// ── Nav API — always call same-origin from the reader frame so HttpOnly
// CloudFront cookies are correctly set for reader.readmoo.com ──────────────────
async function getNavBasePath(bookId, readerFrameTabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: readerFrameTabId, allFrames: true },
    func: async (bookId, bearer) => {
      if (location.hostname !== 'reader.readmoo.com' || !location.pathname.startsWith('/reader/')) return null;
      try {
        const resp = await fetch(`/api/book/${bookId}/nav`, {
          headers: { authorization: `bearer ${bearer}`, 'x-requested-with': 'XMLHttpRequest' },
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        const data = await resp.json();
        return data.base ? { base: data.base } : { error: data.message || 'no base' };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [bookId, READMOO_BEARER],
  });
  const success = results.find(r => r.result?.base);
  if (success) return success.result.base;
  const errResult = results.find(r => r.result?.error);
  throw new Error(errResult?.result?.error || 'Nav API failed');
}

// ── Open a background reader tab and wait for reader.readmoo.com iframe ───────
async function openAndWaitForReaderFrame(bookId) {
  const tab = await chrome.tabs.create({
    url: `https://new-read.readmoo.com/mooreader/${bookId}`,
    active: false,
  });
  const tabId = tab.id;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      ok ? resolve() : reject(err);
    };
    const timeout = setTimeout(
      () => finish(false, new Error('Reader tab load timeout')),
      30000
    );
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(true);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') finish(true); }).catch(() => {});
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 800));
    try {
      const rs = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => location.hostname === 'reader.readmoo.com' && location.pathname.startsWith('/reader/'),
      });
      if (rs.some(r => r.result)) return tabId;
    } catch (_) {}
  }

  chrome.tabs.remove(tabId).catch(() => {});
  throw new Error('Reader iframe did not load');
}

async function ensureReaderFrame(bookId) {
  const specific = await chrome.tabs.query({ url: `https://new-read.readmoo.com/mooreader/${bookId}*` });
  if (specific.length > 0) {
    const check = await chrome.scripting.executeScript({
      target: { tabId: specific[0].id, allFrames: true },
      func: () => location.hostname === 'reader.readmoo.com' && location.pathname.startsWith('/reader/'),
    });
    if (check.some(r => r.result)) return { tabId: specific[0].id, created: false };
  }

  const any = await chrome.tabs.query({ url: 'https://new-read.readmoo.com/*' });
  if (any.length > 0) {
    const check = await chrome.scripting.executeScript({
      target: { tabId: any[0].id, allFrames: true },
      func: () => location.hostname === 'reader.readmoo.com' && location.pathname.startsWith('/reader/'),
    });
    if (check.some(r => r.result)) return { tabId: any[0].id, created: false };
  }

  // First attempt
  try {
    const tabId = await openAndWaitForReaderFrame(bookId);
    return { tabId, created: true };
  } catch (_) {}

  // Auto-retry once if iframe didn't load in time
  const tabId = await openAndWaitForReaderFrame(bookId);
  return { tabId, created: true };
}

// ── Phase 1: get file list from frame (container.xml + opf + manifest paths) ──
async function getFileListFromFrame(tabId, basePath) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: async (basePath) => {
      if (location.hostname !== 'reader.readmoo.com' || !location.pathname.startsWith('/reader/')) return null;
      const origin = location.origin;
      const fetchB64 = async (path) => {
        const resp = await fetch(`${origin}${basePath}${path}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${path}`);
        const arr = new Uint8Array(await resp.arrayBuffer());
        let s = ''; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return btoa(s);
      };
      try {
        const containerB64 = await fetchB64('META-INF/container.xml');
        const containerText = new TextDecoder().decode(
          Uint8Array.from(atob(containerB64), c => c.charCodeAt(0))
        );
        const rootFilePath = containerText.match(/full-path="([^"]+)"/)?.[1];
        if (!rootFilePath) return { error: 'No rootfile in container.xml' };

        const opfB64 = await fetchB64(rootFilePath);
        const opfText = new TextDecoder().decode(
          Uint8Array.from(atob(opfB64), c => c.charCodeAt(0))
        );
        const opfDir = rootFilePath.includes('/')
          ? rootFilePath.substring(0, rootFilePath.lastIndexOf('/') + 1) : '';
        const manifestPaths = [];
        const itemRe = /<item\b[^>]+href="([^"]+)"[^>]*\/?>/g;
        let m;
        while ((m = itemRe.exec(opfText)) !== null) manifestPaths.push(opfDir + m[1]);

        let encryptionB64 = null;
        try { encryptionB64 = await fetchB64('META-INF/encryption.xml'); } catch (_) {}

        return { containerB64, opfB64, rootFilePath, manifestPaths, encryptionB64 };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [basePath],
  });
  const success = results.find(r => r.result && !r.result.error);
  if (!success) {
    const errResult = results.find(r => r.result?.error);
    throw new Error(errResult?.result?.error || 'Failed to get file list from reader frame');
  }
  return success.result;
}

// ── Phase 2: fetch one file from frame, return base64 ─────────────────────────
async function fetchFileFromFrame(tabId, basePath, filePath, retries = 4) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: async (basePath, filePath) => {
      if (location.hostname !== 'reader.readmoo.com' || !location.pathname.startsWith('/reader/')) return null;
      try {
        const resp = await fetch(`${location.origin}${basePath}${filePath}`);
        if (!resp.ok) return { error: `HTTP ${resp.status}: ${filePath}`, status: resp.status };
        const arr = new Uint8Array(await resp.arrayBuffer());
        let s = ''; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return { b64: btoa(s) };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [basePath, filePath],
  });
  const success = results.find(r => r.result?.b64 != null);
  if (!success) {
    const errResult = results.find(r => r.result?.error);
    const is403 = errResult?.result?.status === 403;
    if (is403 && retries > 0) {
      const wait = retries >= 3 ? 2000 : retries === 2 ? 4000 : retries === 1 ? 7000 : 10000;
      await new Promise(r => setTimeout(r, wait));
      return fetchFileFromFrame(tabId, basePath, filePath, retries - 1);
    }
    throw new Error(errResult?.result?.error || `Failed to fetch ${filePath}`);
  }
  return success.result.b64;
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function downloadReadmooBook(bookId, format = 'epub', sendProgress, { delayMs = 1000, signal, bookTitle } = {}) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  sendProgress({ stage: 'fetch', msg: 'Opening reader...' });
  const { tabId, created } = await ensureReaderFrame(bookId);

  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  sendProgress({ stage: 'nav', msg: 'Getting book path...' });
  const basePath = await getNavBasePath(bookId, tabId);

  try {
    // Phase 1: get container.xml, opf, manifest file list
    const { containerB64, opfB64, rootFilePath, manifestPaths, encryptionB64 } =
      await getFileListFromFrame(tabId, basePath);

    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const files = {
      'META-INF/container.xml': containerB64,
      [rootFilePath]: opfB64,
    };
    if (encryptionB64) files['META-INF/encryption.xml'] = encryptionB64;

    // Phase 2: fetch each manifest file with per-file progress
    const total = manifestPaths.length;
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const path = manifestPaths[i];
      sendProgress({ stage: 'fetch', msg: `${i + 1}/${total} ${path}`, pct: (i + 1) / total });
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      files[path] = await fetchFileFromFrame(tabId, basePath, path);
    }

    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    // Build filesMap and package EPUB
    sendProgress({ stage: 'packaging', msg: 'Packaging EPUB...' });
    const filesMap = new Map();
    filesMap.set('mimetype', new TextEncoder().encode('application/epub+zip'));
    for (const [path, b64] of Object.entries(files)) {
      filesMap.set(path, Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    }

    const contentOpfXml = new TextDecoder().decode(filesMap.get(rootFilePath));
    const { title } = parseContentOpf(contentOpfXml, rootFilePath);

    const finalMap = format === 'kepub'
      ? convertToKepub(filesMap, contentOpfXml, rootFilePath)
      : filesMap;
    const blob = await buildEpub(finalMap);

    sendProgress({ stage: 'saving', msg: 'Saving...' });
    const allBytes = new Uint8Array(await blob.arrayBuffer());
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < allBytes.length; i += CHUNK)
      binary += String.fromCharCode(...allBytes.subarray(i, Math.min(i + CHUNK, allBytes.length)));
    const dataUrl = `data:application/epub+zip;base64,${btoa(binary)}`;
    const ext = format === 'kepub' ? '.kepub.epub' : '.epub';
    const safeName = (title || bookTitle || bookId).replace(/[/\\:*?"<>|]/g, '_');

    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: dataUrl, filename: `${safeName}${ext}`, saveAs: false },
        id => {
          if (id === undefined) reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
          else resolve();
        }
      );
    });

    sendProgress({ stage: 'done', msg: `${title} downloaded!` });
    return title;
  } finally {
    if (created) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

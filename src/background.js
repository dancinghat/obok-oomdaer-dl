import { downloadBook } from './downloader.js';
import { downloadReadmooBook } from './readmoo_downloader.js';
import { getCmsToken } from './api.js';

const DEFAULT_SETTINGS = { apiDelay: 1000, readmooDelay: 0 };

const updateDlState = (bookId, progress) =>
  chrome.storage.session.set({ [`dl_${bookId}`]: progress }).catch(() => {});
const clearDlState = (bookId) =>
  chrome.storage.session.remove(`dl_${bookId}`).catch(() => {});

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings').catch(() => ({}));
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

// In-memory queue: [{ bookId, format, source }]
// source: 'books' | 'readmoo'
const queue = [];
let processing = false;
let currentAbortController = null;

function broadcastQueue() {
  const ids = queue.map(i => i.bookId);
  chrome.runtime.sendMessage({ action: 'queueUpdate', queue: ids }).catch(() => {});
  chrome.storage.session.set({ downloadQueue: ids }).catch(() => {});
}

async function processNext() {
  if (processing || queue.length === 0) return;
  processing = true;

  const { bookId, format, source, bookTitle } = queue[0];
  broadcastQueue();

  const sendProgress = data => {
    updateDlState(bookId, data);
    chrome.runtime.sendMessage({ action: 'progress', bookId, data }).catch(() => {});
  };

  const abortController = new AbortController();
  currentAbortController = abortController;

  try {
    const { apiDelay, readmooDelay } = await loadSettings();

    if (source === 'readmoo') {
      const rawId = bookId.replace(/^readmoo_/, '');
      await downloadReadmooBook(rawId, format, sendProgress, { delayMs: readmooDelay, signal: abortController.signal, bookTitle });
    } else {
      await downloadBook(bookId, format, sendProgress, { delayMs: apiDelay, signal: abortController.signal });
    }
  } catch (err) {
    clearDlState(bookId);
    if (err.name !== 'AbortError') {
      chrome.storage.session.set({ [`err_${bookId}`]: err.message }).catch(() => {});
      chrome.runtime.sendMessage({ action: 'error', bookId, error: err.message }).catch(() => {});
    }
  }

  currentAbortController = null;
  queue.shift();
  processing = false;
  broadcastQueue();
  processNext();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startDownload') {
    sendResponse({ status: 'queued' });
    queue.push({ bookId: msg.bookId, format: msg.format ?? 'epub', source: msg.source ?? 'books', bookTitle: msg.bookTitle ?? null });
    broadcastQueue();
    processNext();
    return true;
  }

  if (msg.action === 'cancelAll') {
    const cancelledIds = queue.map(i => i.bookId);
    queue.length = 0;
    currentAbortController?.abort();
    currentAbortController = null;
    processing = false;
    for (const id of cancelledIds) clearDlState(id);
    broadcastQueue();
    chrome.runtime.sendMessage({ action: 'cancelledAll', bookIds: cancelledIds }).catch(() => {});
    sendResponse({ status: 'cancelled' });
    return true;
  }

  if (msg.action === 'getSettings') {
    loadSettings().then(settings => sendResponse({ settings }));
    return true;
  }

  if (msg.action === 'saveSettings') {
    chrome.storage.sync.set({ settings: msg.settings })
      .then(() => sendResponse({ status: 'ok' }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === 'getReadList') {
    (async () => {
      try {
        const cmsToken = await getCmsToken();
        if (!cmsToken) { sendResponse({ error: 'NO_CMS_TOKEN' }); return; }

        const tabs = await chrome.tabs.query({ url: 'https://*.books.com.tw/*' });
        if (tabs.length === 0) { sendResponse({ error: 'NEED_BOOKS_TAB' }); return; }

        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: async (offset) => {
            try {
              const body = new URLSearchParams({
                offset: String(offset),
                page_size: '40',
                sort_order: 'ReadTimeDesc',
                last_updated_time: '1900-01-01T00:00:00+08:00',
                eplanid: 'all',
                is_buyout: '',
                listname: '["all","trial"]',
                cat: 'all',
              });
              const resp = await fetch('https://appapi-ebook.books.com.tw/V1.7/CMSAPIApp/ReadList', {
                method: 'POST',
                headers: {
                  accept: 'application/json, text/javascript, */*; q=0.01',
                  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                },
                credentials: 'include',
                body: body.toString(),
                signal: AbortSignal.timeout(20000),
              });
              if (!resp.ok) return { error: `ReadList HTTP ${resp.status}` };
              return { data: await resp.json() };
            } catch (e) {
              return { error: e.message };
            }
          },
          args: [msg.offset ?? 0],
        });

        if (result.error) { sendResponse({ error: result.error }); return; }
        sendResponse({ data: result.data });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.action === 'getReadmooList') {
    (async () => {
      try {
        // Get oauth_token from any open readmoo tab via document.cookie injection.
        // chrome.cookies.getAll is unreliable for subdomain cookies in MV3;
        // document.cookie on read.readmoo.com is guaranteed to have the token.
        const tabs = await chrome.tabs.query({ url: 'https://*.readmoo.com/*' });
        if (tabs.length === 0) { sendResponse({ error: 'NEED_READMOO_TAB' }); return; }

        const [{ result: oauthToken }] = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            const entry = document.cookie.split('; ').find(c => c.startsWith('oauth_token='));
            return entry ? entry.split('=').slice(1).join('=') : null;
          },
        });

        if (!oauthToken) { sendResponse({ error: 'NO_READMOO_AUTH' }); return; }

        // Make API call from service worker — no CORS restriction with host_permissions.
        const resp = await fetch(
          'https://api.readmoo.com/store/v3/me/library_items?page%5Bcount%5D=200',
          { headers: { Authorization: `Bearer ${oauthToken}` } }
        );
        if (resp.status === 401 || resp.status === 403) { sendResponse({ error: 'NO_READMOO_AUTH' }); return; }
        if (!resp.ok) { sendResponse({ error: `API_HTTP_${resp.status}` }); return; }

        sendResponse({ data: await resp.json() });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

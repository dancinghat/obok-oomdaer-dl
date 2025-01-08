import { downloadBook } from './downloader.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'startDownload') return;

  sendResponse({ status: 'started' });

  const sendProgress = data =>
    chrome.runtime.sendMessage({ action: 'progress', data }).catch(() => {});

  downloadBook(msg.bookId, sendProgress).catch(err =>
    chrome.runtime.sendMessage({ action: 'error', error: err.message }).catch(() => {})
  );

  return true; // keep message channel open for async response
});

const bookIdInput = document.getElementById('bookId');
const downloadBtn = document.getElementById('downloadBtn');
const statusArea = document.getElementById('statusArea');
const progressFill = document.getElementById('progressFill');
const statusMsg = document.getElementById('statusMsg');
const errorArea = document.getElementById('errorArea');

// Auto-fill book_uni_id from the active viewer tab URL
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const m = tab?.url?.match(/book_uni_id=([^&]+)/);
  if (m) bookIdInput.value = decodeURIComponent(m[1]);
});

downloadBtn.addEventListener('click', () => {
  const bookId = bookIdInput.value.trim();
  if (!bookId) return;

  downloadBtn.disabled = true;
  errorArea.classList.add('hidden');
  errorArea.textContent = '';
  statusArea.classList.remove('hidden');
  statusMsg.textContent = '準備中...';
  progressFill.style.width = '0%';

  chrome.runtime.sendMessage({ action: 'startDownload', bookId });
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'progress') {
    const { stage, msg: text, pct } = msg.data;
    statusMsg.textContent = text;
    if (pct !== undefined) progressFill.style.width = `${Math.round(pct * 100)}%`;
    if (stage === 'done') {
      downloadBtn.disabled = false;
      progressFill.style.width = '100%';
    }
  }

  if (msg.action === 'error') {
    downloadBtn.disabled = false;
    statusArea.classList.add('hidden');
    errorArea.classList.remove('hidden');
    if (msg.error === 'NO_CMS_TOKEN') {
      errorArea.innerHTML =
        '請先在瀏覽器<a href="https://viewer-ebook.books.com.tw" target="_blank">登入 books.com.tw</a>，再點擊下載。';
    } else {
      errorArea.textContent = `錯誤：${msg.error}`;
    }
  }
});

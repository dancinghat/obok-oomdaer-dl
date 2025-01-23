import { getCmsToken, deviceReg, getBookDownloadInfo, fetchFile } from './api.js';
import { parseContainerXml, parseContentOpf } from './parser.js';
import { buildEpub } from './epub.js';
import { convertToKepub } from './kepub.js';
import { generateKey, decodeXor } from './crypto/crypto.js';

function delayWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    }, { once: true });
  });
}

// Port of lib/books_dl/downloader.rb#perform
// sendProgress: ({ stage, msg, pct? }) => void
// options.delayMs: ms to wait between file fetches (default 1000)
// options.signal: AbortSignal for cancellation
export async function downloadBook(bookId, format = 'epub', sendProgress, { delayMs = 1000, signal } = {}) {
  sendProgress({ stage: 'auth', msg: 'Reading CmsToken...' });
  const cmsToken = await getCmsToken();
  if (!cmsToken) throw new Error('NO_CMS_TOKEN');

  sendProgress({ stage: 'device', msg: 'Registering device...' });
  await deviceReg(cmsToken);

  sendProgress({ stage: 'book_info', msg: 'Fetching book info...' });
  const { download_link, download_token, encrypt_type } = await getBookDownloadInfo(bookId, cmsToken);

  async function fetchDecrypt(path) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const url = `${download_link}${path}`;
    const { bytes, encrypted } = await fetchFile(url, download_token, encrypt_type, signal);
    if (!encrypted) return bytes;
    const key = await generateKey(url, download_token);
    return decodeXor(key, bytes);
  }

  sendProgress({ stage: 'container', msg: 'META-INF/container.xml...' });
  const containerBytes = await fetchDecrypt('META-INF/container.xml');
  const containerXml = new TextDecoder().decode(containerBytes);
  const rootFilePath = parseContainerXml(containerXml);

  // encryption.xml is optional — mirror Ruby's rescue behavior
  let encryptionBytes = null;
  try {
    encryptionBytes = await fetchDecrypt('META-INF/encryption.xml');
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }

  sendProgress({ stage: 'opf', msg: `${rootFilePath}...` });
  const opfBytes = await fetchDecrypt(rootFilePath);
  const contentOpfXml = new TextDecoder().decode(opfBytes);
  const { title, filePaths } = parseContentOpf(contentOpfXml, rootFilePath);

  // Build EPUB file map — mimetype must be inserted first (STORE, per EPUB spec)
  const filesMap = new Map();
  filesMap.set('mimetype', new TextEncoder().encode('application/epub+zip'));
  filesMap.set('META-INF/container.xml', containerBytes);
  if (encryptionBytes) filesMap.set('META-INF/encryption.xml', encryptionBytes);
  filesMap.set(rootFilePath, opfBytes);

  const total = filePaths.length;
  for (let i = 0; i < total; i++) {
    sendProgress({ stage: 'file', msg: `${i + 1}/${total} ${filePaths[i]}`, pct: (i + 1) / total });
    const bytes = await fetchDecrypt(filePaths[i]);
    filesMap.set(filePaths[i], bytes);
    if (i < total - 1) await delayWithAbort(delayMs, signal);
  }

  sendProgress({ stage: 'packaging', msg: 'Packaging EPUB...' });
  const finalMap = format === 'kepub' ? convertToKepub(filesMap, contentOpfXml, rootFilePath) : filesMap;
  const blob = await buildEpub(finalMap);

  sendProgress({ stage: 'saving', msg: 'Saving...' });
  // URL.createObjectURL is unavailable in MV3 service workers; use a base64 data URL instead.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  const dataUrl = `data:application/epub+zip;base64,${btoa(binary)}`;
  const ext = format === 'kepub' ? '.kepub.epub' : '.epub';

  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: dataUrl, filename: `${bookId}_${title}${ext}`, saveAs: false },
      id => {
        if (id === undefined) reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
        else resolve();
      }
    );
  });

  sendProgress({ stage: 'done', msg: `${bookId} downloaded!` });
  return title;
}

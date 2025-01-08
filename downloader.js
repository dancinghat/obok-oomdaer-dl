import { getCmsToken, deviceReg, getBookDownloadInfo, fetchFile } from './api.js';
import { parseContainerXml, parseContentOpf } from './parser.js';
import { buildEpub } from './epub.js';
import { generateKey, decodeXor } from './crypto/crypto.js';

const delay = ms => new Promise(r => setTimeout(r, ms));

// Port of lib/books_dl/downloader.rb#perform
// sendProgress: ({ stage, msg, pct? }) => void
export async function downloadBook(bookId, sendProgress) {
  sendProgress({ stage: 'auth', msg: '讀取 CmsToken...' });
  const cmsToken = await getCmsToken();
  if (!cmsToken) throw new Error('NO_CMS_TOKEN');

  sendProgress({ stage: 'device', msg: '註冊 Fake device...' });
  await deviceReg(cmsToken);

  sendProgress({ stage: 'book_info', msg: '取得書籍下載資訊...' });
  const { download_link, download_token, encrypt_type } = await getBookDownloadInfo(bookId, cmsToken);

  async function fetchDecrypt(path) {
    const url = `${download_link}${path}`;
    const { bytes, encrypted } = await fetchFile(url, download_token, encrypt_type);
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
  } catch (_) {}

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
    if (i < total - 1) await delay(1000);
  }

  sendProgress({ stage: 'packaging', msg: 'EPUB 封裝中...' });
  const blob = await buildEpub(filesMap);

  sendProgress({ stage: 'saving', msg: '儲存中...' });
  const objUrl = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: objUrl, filename: `${bookId}_${title}.epub`, saveAs: false },
      id => {
        URL.revokeObjectURL(objUrl);
        if (id === undefined) reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
        else resolve();
      }
    );
  });

  sendProgress({ stage: 'done', msg: `${bookId} 下載完成！` });
  return title;
}

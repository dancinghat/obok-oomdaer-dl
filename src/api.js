import { imgChecksum } from './crypto/crypto.js';

const BASE_URL = 'https://appapi-ebook.books.com.tw/V1.7/CMSAPIApp';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const IMAGE_EXTS = new Set(['.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.tiff', '.tif', '.svg', '.png', '.webp']);
const NO_AUTH_EXTS = new Set(['.css', '.ttc', '.otf', '.ttf', '.eot', '.woff', '.woff2']);

export async function getCmsToken() {
  return new Promise(resolve => {
    chrome.cookies.getAll({ name: 'CmsToken' }, cookies => {
      resolve(cookies.length > 0 ? cookies[0].value : null);
    });
  });
}

// Returns all cookies for books.com.tw and its subdomains as a Cookie header string.
async function getAllCookieString() {
  return new Promise(resolve => {
    chrome.cookies.getAll({ domain: 'books.com.tw' }, cookies => {
      resolve(cookies.map(c => `${c.name}=${c.value}`).join('; '));
    });
  });
}

export async function deviceReg(cmsToken) {
  const body = new URLSearchParams({
    device_id: '2b2475e7-da58-4cfe-aedf-ab4e6463757b',
    language: 'zh-TW',
    os_type: 'WEB',
    os_version: USER_AGENT,
    screen_resolution: '1680X1050',
    screen_dpi: '96',
    device_vendor: 'Google Inc.',
    device_model: 'web',
  });
  return fetch(`${BASE_URL}/DeviceReg`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: `CmsToken=${cmsToken}`,
      Origin: 'https://viewer-ebook.books.com.tw',
      Referer: 'https://viewer-ebook.books.com.tw/viewer/epub/web/?book_uni_id=E050017049_reflowable_normal',
    },
    body: body.toString(),
  });
}

export async function getBookDownloadInfo(bookId, cmsToken) {
  const t = Math.floor(Date.now() / 1000);
  const resp = await fetch(`${BASE_URL}/BookDownLoadURL?book_uni_id=${bookId}&t=${t}`, {
    headers: { 'User-Agent': USER_AGENT, Cookie: `CmsToken=${cmsToken}` },
  });
  if (!resp.ok) throw new Error(`BookDownLoadURL HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error_code) throw new Error(`BookDownLoadURL failed: ${data.error_message}`);
  return data; // { download_link, download_token, encrypt_type, ... }
}

export async function getReadList(offset = 0) {
  const cookieStr = await getAllCookieString();
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
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: cookieStr,
      Origin: 'https://viewer-ebook.books.com.tw',
      Referer: 'https://viewer-ebook.books.com.tw/',
    },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`ReadList HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error_code) throw new Error(`ReadList: ${data.error_message}`);
  return data;
}

export async function fetchFile(url, downloadToken, encryptType, signal) {
  const cleanUrl = url.split('?')[0];
  const ext = '.' + cleanUrl.split('.').pop().toLowerCase();
  const headers = { 'User-Agent': USER_AGENT };
  const encodedToken = encodeURIComponent(downloadToken);

  if (NO_AUTH_EXTS.has(ext) || encryptType === 'none') {
    const resp = await fetch(url, { headers, signal });
    if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${url}`);
    return { bytes: new Uint8Array(await resp.arrayBuffer()), encrypted: false };
  }

  if (IMAGE_EXTS.has(ext)) {
    const checksum = imgChecksum();
    const resp = await fetch(`${url}?checksum=${checksum}&DownloadToken=${encodedToken}`, { headers, signal });
    if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${url}`);
    return { bytes: new Uint8Array(await resp.arrayBuffer()), encrypted: false };
  }

  const resp = await fetch(`${url}?DownloadToken=${encodedToken}`, { headers, signal });
  if (!resp.ok) throw new Error(`Fetch ${resp.status}: ${url}`);
  return { bytes: new Uint8Array(await resp.arrayBuffer()), encrypted: true };
}

import { md5 } from './md5.js';

// Mirrors Ruby: %r{\Ahttps?://(.*?/){3}.*?(?<rest_part>/.+)\z}
// Skips scheme + 3 path segments (domain, V1.0, Streaming), captures from the next '/' onward.
function extractFilePath(url) {
  const match = url.match(/^https?:\/\/(.*?\/){3}.*?(\/[^]+)$/);
  if (!match) throw new Error('Unexpected URL format: ' + url);
  return decodeURIComponent(match[2]);
}

export async function generateKey(url, downloadToken) {
  const filePath = extractFilePath(url);
  const md5hex = md5(filePath);
  const chunks = md5hex.match(/.{4}/g); // 8 chunks of 4 hex chars
  const partition = chunks.reduce((acc, c) => (acc + parseInt(c, 16)) % 64, 0);
  const input = downloadToken.slice(0, partition) + filePath + downloadToken.slice(partition);
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(hashBuf); // 32-byte XOR key
}

export function decodeXor(key, encryptedBytes) {
  const result = new Uint8Array(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i++) {
    result[i] = encryptedBytes[i] ^ key[i % key.length];
  }
  // Strip UTF-8 BOM (EF BB BF)
  if (result[0] === 0xef && result[1] === 0xbb && result[2] === 0xbf) {
    return result.slice(3);
  }
  return result;
}

export function imgChecksum() {
  const seed = ['0', '6', '9', '3', '1', '4', '7', '1', '8', '0', '5', '5', '9', 'A', 'A', 'C'];
  for (let i = 0; i < seed.length; i++) {
    const j = Math.floor(Math.random() * seed.length);
    [seed[i], seed[j]] = [seed[j], seed[i]];
  }
  return seed.join('');
}

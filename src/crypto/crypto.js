// Crypto module — implementation not included in this repository.
//
// To build a working extension, provide your own implementation of the three
// exports below and place it at src/crypto/crypto.real.js (gitignored).
// The Vite build will automatically prefer crypto.real.js over this stub.
//
// Hints
// -----
// generateKey  — derives a 32-byte XOR key from the file URL and download_token.
//                The key is produced by SHA-256 hashing a string assembled from:
//                  • a path segment extracted from the URL (skipping scheme + 3 segments)
//                  • the download_token, split at a position derived from an MD5 of that path
//
//                URL path extraction pattern (scheme + 3 segments skipped):
//                  /^https?:\/\/(.*?\/){3}.*?(\/[^]+)$/
// decodeXor    — applies the key cyclically (key[i % key.length]) and strips a leading
//                UTF-8 BOM (0xEF 0xBB 0xBF) if present
// imgChecksum  — returns a 16-char hex string used during device registration;
//                the chars are a fixed set shuffled with Fisher-Yates each call

export async function generateKey(_url, _downloadToken) {
  throw new Error(
    'crypto.js: not implemented. Provide src/crypto/crypto.real.js — see comments above.'
  );
}

export function decodeXor(_key, _encryptedBytes) {
  throw new Error(
    'crypto.js: not implemented. Provide src/crypto/crypto.real.js — see comments above.'
  );
}

export function imgChecksum() {
  throw new Error(
    'crypto.js: not implemented. Provide src/crypto/crypto.real.js — see comments above.'
  );
}

// Minimal ZIP builder for EPUB. Uses CompressionStream('deflate-raw') for DEFLATE.
// Chrome 80+ required (CompressionStream support).

function crc32(data) {
  if (!crc32._t) {
    crc32._t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32._t[i] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crc32._t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

const le16 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
const le32 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; b[o + 2] = (v >> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; };

// filesMap: Map<string, Uint8Array> — 'mimetype' must be the first entry (STORE, per EPUB spec).
export async function buildEpub(filesMap) {
  const enc = new TextEncoder();
  const entries = [];
  let localOffset = 0;

  for (const [path, data] of filesMap) {
    const nameBytes = enc.encode(path);
    const isStore = path === 'mimetype';
    let compressed = data;
    let method = 0; // STORE

    if (!isStore) {
      const deflated = await deflateRaw(data);
      if (deflated.length < data.length) {
        compressed = deflated;
        method = 8; // DEFLATE
      }
    }

    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    le32(local,  0, 0x04034b50); // local file header signature
    le16(local,  4, 20);          // version needed
    le16(local,  6, 0);           // general purpose flags
    le16(local,  8, method);
    le16(local, 10, 0);           // mod time
    le16(local, 12, 0);           // mod date
    le32(local, 14, crc);
    le32(local, 18, compressed.length);
    le32(local, 22, data.length);
    le16(local, 26, nameBytes.length);
    le16(local, 28, 0);           // extra field length
    local.set(nameBytes, 30);

    entries.push({ nameBytes, local, compressed, crc, dataLen: data.length, method, offset: localOffset });
    localOffset += local.length + compressed.length;
  }

  const cdOffset = localOffset;
  const centralParts = entries.map(e => {
    const cd = new Uint8Array(46 + e.nameBytes.length);
    le32(cd,  0, 0x02014b50); // central dir signature
    le16(cd,  4, 20);
    le16(cd,  6, 20);
    le16(cd,  8, 0);
    le16(cd, 10, e.method);
    le16(cd, 12, 0);
    le16(cd, 14, 0);
    le32(cd, 16, e.crc);
    le32(cd, 20, e.compressed.length);
    le32(cd, 24, e.dataLen);
    le16(cd, 28, e.nameBytes.length);
    le16(cd, 30, 0); le16(cd, 32, 0); le16(cd, 34, 0);
    le16(cd, 36, 0); le32(cd, 38, 0); le32(cd, 42, e.offset);
    cd.set(e.nameBytes, 46);
    return cd;
  });

  const cdSize = centralParts.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  le32(eocd,  0, 0x06054b50); // end of central dir signature
  le16(eocd,  4, 0); le16(eocd,  6, 0);
  le16(eocd,  8, entries.length);
  le16(eocd, 10, entries.length);
  le32(eocd, 12, cdSize);
  le32(eocd, 16, cdOffset);
  le16(eocd, 20, 0);

  const parts = [];
  for (const e of entries) parts.push(e.local, e.compressed);
  for (const c of centralParts) parts.push(c);
  parts.push(eocd);

  return new Blob(parts, { type: 'application/epub+zip' });
}

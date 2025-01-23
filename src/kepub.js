// Port of lib/books_dl/kepub_converter.rb
// Injects koboSpan elements into XHTML spine files for Kobo e-readers.
// DOMParser is unavailable in MV3 service workers, so we use a custom tokenizer.

const SKIP_TAGS = new Set(['script', 'style', 'head', 'title']);

export function convertToKepub(filesMap, opfXml, rootFilePath) {
  const spineIndexMap = buildSpineIndexMap(opfXml, rootFilePath);
  const result = new Map();
  for (const [path, bytes] of filesMap) {
    const spineIndex = spineIndexMap.get(path);
    if (spineIndex === undefined) {
      result.set(path, bytes);
      continue;
    }
    const xml = new TextDecoder().decode(bytes);
    const processed = processXhtml(xml, spineIndex);
    result.set(path, new TextEncoder().encode(processed !== null ? processed : xml));
  }
  return result;
}

function buildSpineIndexMap(opfXml, rootFilePath) {
  const baseDir = rootFilePath.includes('/')
    ? rootFilePath.slice(0, rootFilePath.lastIndexOf('/') + 1)
    : '';

  const hrefById = new Map();
  const itemRe = /<item\b([^>]+)>/g;
  let m;
  while ((m = itemRe.exec(opfXml)) !== null) {
    const attrs = m[1];
    if (!/\bmedia-type="application\/xhtml\+xml"/.test(attrs)) continue;
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const href = /\bhref="([^"]+)"/.exec(attrs)?.[1];
    if (id && href) hrefById.set(id, href);
  }

  const map = new Map();
  const itemrefRe = /<itemref\b([^>]+)>/g;
  let idx = 1;
  while ((m = itemrefRe.exec(opfXml)) !== null) {
    const idref = /\bidref="([^"]+)"/.exec(m[1])?.[1];
    if (!idref) continue;
    const href = hrefById.get(idref);
    if (href) map.set(baseDir + href, idx++);
  }
  return map;
}

// Tokenizes XML into: text | open | close | selfclose | other (comments, PIs, CDATA)
// Handles quoted attribute values that may contain '>' correctly.
function tokenize(xml) {
  const tokens = [];
  let i = 0;

  while (i < xml.length) {
    if (xml[i] !== '<') {
      const start = i;
      while (i < xml.length && xml[i] !== '<') i++;
      tokens.push({ type: 'text', value: xml.slice(start, i) });
    } else if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      const j = end === -1 ? xml.length : end + 3;
      tokens.push({ type: 'other', value: xml.slice(i, j) });
      i = j;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      const j = end === -1 ? xml.length : end + 3;
      tokens.push({ type: 'other', value: xml.slice(i, j) });
      i = j;
    } else if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      const j = end === -1 ? xml.length : end + 2;
      tokens.push({ type: 'other', value: xml.slice(i, j) });
      i = j;
    } else if (xml.startsWith('</', i)) {
      const end = xml.indexOf('>', i + 2);
      const j = end === -1 ? xml.length : end + 1;
      const tagStr = xml.slice(i, j);
      const name = /^<\/([^\s>]+)/.exec(tagStr)?.[1]?.split(':').pop()?.toLowerCase() ?? '';
      tokens.push({ type: 'close', name, value: tagStr });
      i = j;
    } else {
      // open or self-closing — scan past quoted attributes so '>' inside them is ignored
      let j = i + 1;
      while (j < xml.length) {
        if (xml[j] === '"' || xml[j] === "'") {
          const q = xml[j++];
          while (j < xml.length && xml[j] !== q) j++;
          if (j < xml.length) j++;
        } else if (xml[j] === '>') { j++; break; }
        else j++;
      }
      const tagStr = xml.slice(i, j);
      const name = /^<([^\s>/]+)/.exec(tagStr)?.[1]?.split(':').pop()?.toLowerCase() ?? '';
      tokens.push({ type: tagStr.endsWith('/>') ? 'selfclose' : 'open', name, value: tagStr });
      i = j;
    }
  }

  return tokens;
}

function processXhtml(xml, spineIndex) {
  const tokens = tokenize(xml);
  const tagStack = [];
  let textIdx = 0;
  let hasWrapped = false;
  const out = [];

  for (const tok of tokens) {
    if (tok.type === 'open') {
      tagStack.push(tok.name);
      out.push(tok.value);
    } else if (tok.type === 'close') {
      // pop the last matching open tag (handles malformed nesting gracefully)
      for (let i = tagStack.length - 1; i >= 0; i--) {
        if (tagStack[i] === tok.name) { tagStack.splice(i, 1); break; }
      }
      out.push(tok.value);
    } else if (tok.type === 'text') {
      const inSkip = tagStack.some(t => SKIP_TAGS.has(t));
      if (!inSkip && tok.value.trim()) {
        hasWrapped = true;
        out.push(`<span class="koboSpan" id="kobo.${spineIndex}.${++textIdx}">${tok.value}</span>`);
      } else {
        out.push(tok.value);
      }
    } else {
      out.push(tok.value);
    }
  }

  // Return null when there are no wrappable text nodes (e.g. SVG-only cover pages)
  return hasWrapped ? out.join('') : null;
}

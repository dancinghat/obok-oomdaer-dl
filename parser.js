// Port of lib/books_dl/files/container.rb
export function parseContainerXml(xml) {
  const match = xml.match(/full-path="([^"]+)"/);
  if (!match) throw new Error('Invalid container.xml: no full-path found');
  return match[1]; // e.g. "OEBPS/content.opf"
}

// Port of lib/books_dl/files/content.rb
// Note: DOMParser is unavailable in MV3 service workers, so we use regex.
export function parseContentOpf(xml, rootFilePath) {
  // base_dir mirrors Ruby's File.dirname: "OEBPS/content.opf" → "OEBPS/"
  const baseDir = rootFilePath.includes('/')
    ? rootFilePath.substring(0, rootFilePath.lastIndexOf('/') + 1)
    : '';

  // Extract title from <dc:title> (preferred) or <title>
  const titleMatch =
    xml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/) ||
    xml.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : 'unknown';

  // Extract all item hrefs — mirrors: doc.css('item').map { File.join(base_dir, item['href']) }
  const filePaths = [];
  const itemRe = /<item\b[^>]+href="([^"]+)"[^>]*\/?>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    filePaths.push(baseDir + m[1]);
  }
  return { title, filePaths };
}

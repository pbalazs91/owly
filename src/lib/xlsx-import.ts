const MAX_XLSX_BYTES = 25 * 1024 * 1024;

function findEndOfCentralDirectory(view: DataView) {
  const min = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= min; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("The Excel workbook is invalid or corrupted.");
}

async function unzipEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const end = findEndOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  if (count > 2000) throw new Error("The Excel workbook contains too many internal files.");
  let offset = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The Excel workbook is invalid or corrupted.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("The Excel workbook is invalid or corrupted.");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, start, compressedSize);
    if (method === 0) entries.set(name, compressed.slice());
    else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      entries.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else throw new Error("This Excel workbook uses an unsupported compression method.");
    totalBytes += entries.get(name)?.byteLength || 0;
    if (totalBytes > 64 * 1024 * 1024) throw new Error("The uncompressed Excel workbook is too large to process safely.");
  }
  return entries;
}

function xml(bytes: Uint8Array, name: string) {
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error(`The Excel workbook contains invalid ${name} data.`);
  return document;
}

function allElements(element: Element, localName: string) {
  return Array.from(element.getElementsByTagName("*")).filter(item => item.localName === localName);
}

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase();
  if (!letters) return 0;
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function readXlsxAsCsv(file: File) {
  if (file.size > MAX_XLSX_BYTES) throw new Error("The Excel file must be 25 MB or smaller.");
  const entries = await unzipEntries(await file.arrayBuffer());
  const workbookBytes = entries.get("xl/workbook.xml");
  const relationshipsBytes = entries.get("xl/_rels/workbook.xml.rels");
  if (!workbookBytes || !relationshipsBytes) throw new Error("This is not a supported .xlsx workbook.");
  const workbook = xml(workbookBytes, "workbook");
  const relationships = xml(relationshipsBytes, "relationships");
  const firstSheet = allElements(workbook.documentElement, "sheet")[0];
  const relationId = firstSheet?.getAttribute("r:id") || firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  if (!relationId) throw new Error("The Excel workbook has no visible worksheet.");
  const relation = allElements(relationships.documentElement, "Relationship").find(item => item.getAttribute("Id") === relationId);
  const target = relation?.getAttribute("Target");
  if (!target || relation?.getAttribute("TargetMode") === "External") throw new Error("The first worksheet could not be read.");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheetBytes = entries.get(sheetPath.replace(/^xl\/\.\//, "xl/"));
  if (!sheetBytes) throw new Error("The first worksheet could not be read.");
  const sharedBytes = entries.get("xl/sharedStrings.xml");
  const shared = sharedBytes ? allElements(xml(sharedBytes, "shared strings").documentElement, "si").map(item => allElements(item, "t").map(node => node.textContent || "").join("")) : [];
  const sheet = xml(sheetBytes, "worksheet");
  const rows = allElements(sheet.documentElement, "row").map(row => {
    const cells = allElements(row, "c");
    const values: string[] = [];
    for (const cell of cells) {
      const index = columnIndex(cell.getAttribute("r") || "A");
      const type = cell.getAttribute("t");
      const valueNode = allElements(cell, type === "inlineStr" ? "t" : "v")[0];
      const raw = valueNode?.textContent || "";
      values[index] = type === "s" ? shared[Number(raw)] || "" : type === "inlineStr" ? allElements(cell, "t").map(node => node.textContent || "").join("") : raw;
    }
    return values;
  }).filter(row => row.some(value => value?.trim()));
  if (rows.length > 20_001) throw new Error("Up to 20,000 contacts can be imported at a time.");
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

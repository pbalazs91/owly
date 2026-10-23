export type CustomerImportRow = { name: string; companyName: string; businessType: string; companyAddress: string; website: string; email: string; phone: string; whatsapp: string; company: string; tags: string };
export type CustomerImportField = "name" | "companyName" | "businessType" | "companyAddress" | "website" | "email" | "phone" | "whatsapp" | "tags";
export type CustomerImportMapping = Partial<Record<CustomerImportField, string>>;
export const MAX_CUSTOMER_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_IMPORT_CONTACTS = 20_000;

function detectDelimiter(text: string): string {
  const input = text.replace(/^\uFEFF/, "");
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      break;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, counts.get(char)! + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input);
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field); if (row.some(value => value.trim())) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("A CSV-fájlban lezáratlan idézőjel van.");
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function normalizeImportedPhone(value: string) {
  if (!value) return "";
  if (!/^\+?[\d\s().-]+$/.test(value)) throw new Error("A telefonszám csak számjegyet és nemzetközi formázást tartalmazhat.");
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("Országkódos, nemzetközi telefonszámot adj meg.");
  return "+" + digits;
}

export function getCustomerImportCsvHeaders(text: string): string[] {
  if (new TextEncoder().encode(text).byteLength > MAX_CUSTOMER_IMPORT_BYTES) throw new Error("A CSV legfeljebb 25 MB lehet.");
  const rows = parseRows(text);
  const headers = rows.shift()?.map(value => value.trim());
  if (!headers || !headers.length || headers.every(header => !header)) throw new Error("A CSV-fájl üres.");
  const normalized = headers.map(header => header.toLowerCase());
  if (normalized.some(header => !header)) throw new Error("A CSV fejlécében üres oszlopnév van.");
  if (normalized.length !== new Set(normalized).size) throw new Error("A CSV-ben ismétlődő oszlopnév van.");
  if (rows.length > MAX_IMPORT_CONTACTS) throw new Error("Egyszerre legfeljebb 20 000 kontakt importálható.");
  return headers;
}

export function parseCustomerImportCsv(text: string, mapping?: CustomerImportMapping): CustomerImportRow[] {
  if (new TextEncoder().encode(text).byteLength > MAX_CUSTOMER_IMPORT_BYTES) throw new Error("A CSV legfeljebb 25 MB lehet.");
  const rows = parseRows(text);
  const rawHeaders = rows.shift()?.map(value => value.trim());
  if (!rawHeaders || !rawHeaders.length || rawHeaders.every(header => !header)) throw new Error("A CSV-fájl üres.");
  const headers = rawHeaders.map(header => header.toLowerCase());
  if (headers.length !== new Set(headers).size) throw new Error("A CSV-ben ismétlődő oszlopnév van.");
  const supported = new Set(["name", "email", "phone", "whatsapp", "company", "companyname", "businesstype", "companyaddress", "website", "tags"]);
  if (!mapping && headers.some(header => !supported.has(header))) throw new Error("Nem támogatott CSV-oszlop. Válaszd ki az oszlopok megfeleltetését.");
  const sourceColumn = (field: CustomerImportField, values: Record<string, string>) => {
    const key = mapping ? (mapping[field] || "").trim().toLowerCase() : field.toLowerCase();
    if (!key && field === "companyName" && !mapping) return values.company || "";
    return values[key] || (field === "companyName" && !mapping ? values.company || "" : "");
  };
  const parsed: CustomerImportRow[] = [];
  for (const values of rows) {
    const valuesByHeader = Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]));
    const phone = normalizeImportedPhone(sourceColumn("phone", valuesByHeader));
    const whatsapp = normalizeImportedPhone(sourceColumn("whatsapp", valuesByHeader));
    const email = sourceColumn("email", valuesByHeader).trim().toLowerCase();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new Error("Érvényes email-cím szükséges.");
    const website = sourceColumn("website", valuesByHeader).trim();
    if (website) {
      let parsedWebsite: URL;
      try { parsedWebsite = new URL(website); } catch { throw new Error("A weboldal címe http:// vagy https:// kezdetű, érvényes URL legyen."); }
      if (!["http:", "https:"].includes(parsedWebsite.protocol) || website.length > 2048) throw new Error("A weboldal címe http:// vagy https:// kezdetű, érvényes URL legyen.");
    }
    if (!phone && !whatsapp && !email) throw new Error("Minden kontakt sorában kell telefonszám, WhatsApp-szám vagy email-cím.");
    const tags = sourceColumn("tags", valuesByHeader).split(/[;,]/).map(tag => tag.trim()).filter(tag => tag && tag.toLowerCase() !== "active").join(", ");
    const companyName = (sourceColumn("companyName", valuesByHeader)).slice(0, 200);
    const name = sourceColumn("name", valuesByHeader) || companyName;
    parsed.push({ name: name.slice(0, 200), companyName, businessType: sourceColumn("businessType", valuesByHeader).slice(0, 200), companyAddress: sourceColumn("companyAddress", valuesByHeader).slice(0, 500), website, email, phone, whatsapp, company: companyName, tags: tags.slice(0, 1000) });
    if (parsed.length > MAX_IMPORT_CONTACTS) throw new Error("Egyszerre legfeljebb 20 000 kontakt importálható.");
  }
  if (!parsed.length) throw new Error("A CSV nem tartalmaz kontaktot.");
  return parsed;
}

export const customerImportTemplate = "name,companyName,businessType,companyAddress,website,email,phone,whatsapp,tags\r\n";

export type RocketContactImport = {
  phone: string;
  name: string;
  email: string;
  company: string;
  whatsappConsent: boolean;
  consentSource: string;
  consentedAt: string;
};

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
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

export function parseRocketContactFile(text: string): RocketContactImport[] {
  if (new TextEncoder().encode(text).byteLength > 128_000) throw new Error("A fájl legfeljebb 128 kB lehet.");
  const rows = csvRows(text);
  const headers = rows.shift()?.map(value => value.trim().toLowerCase());
  if (!headers || !headers.includes("phone")) throw new Error("A CSV fejlécében kötelező a phone oszlop.");
  const allowed = new Set(["phone", "name", "email", "company", "whatsappconsent", "consentsource", "consentedat"]);
  if (headers.some(header => !allowed.has(header))) throw new Error("Nem támogatott CSV-oszlop. Használd a letölthető sablont.");
  if (headers.length !== new Set(headers).size) throw new Error("A CSV-ben ismétlődő oszlopnév van.");
  const contacts: RocketContactImport[] = [];
  for (const values of rows) {
    const record = Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]));
    let phone: string;
    try {
      const digits = (record.phone || "").replace(/@(c\.us|s\.whatsapp\.net)$/, "").replace(/[+\s().-]/g, "");
      if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("invalid");
      phone = "+" + digits;
    }
    catch { throw new Error("Minden sorhoz érvényes, országkódos telefonszám szükséges."); }
    const consentValue = (record.whatsappconsent || "").toLowerCase();
    if (consentValue && !["true", "yes", "1", "igen"].includes(consentValue) && !["false", "no", "0", "nem"].includes(consentValue)) {
      throw new Error("A whatsappConsent értéke igen/nem vagy true/false legyen.");
    }
    const whatsappConsent = ["true", "yes", "1", "igen"].includes(consentValue);
    const consentSource = (record.consentsource || "").slice(0, 300);
    const consentedAt = record.consentedat || "";
    if (whatsappConsent && (!consentSource || !consentedAt || !Number.isFinite(Date.parse(consentedAt)))) {
      throw new Error("A WhatsApp-hozzájáruláshoz add meg a consentSource és consentedAt adatot is.");
    }
    contacts.push({ phone, name: (record.name || "").slice(0, 200), email: (record.email || "").slice(0, 254), company: (record.company || "").slice(0, 200), whatsappConsent, consentSource, consentedAt });
    if (contacts.length > 250) throw new Error("Egyszerre legfeljebb 250 kontakt importálható.");
  }
  if (!contacts.length) throw new Error("A CSV nem tartalmaz importálható kontaktot.");
  return contacts;
}

export function rocketContactTemplate() {
  return "phone,name,email,company,whatsappConsent,consentSource,consentedAt\r\n";
}

function csvCell(value: unknown) {
  const string = typeof value === "string" ? value : String(value ?? "");
  const safe = /^[=+@\-\t\r]/.test(string) ? `'${string}` : string;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportRocketContacts(rows: Array<{ phone: string; name: string; email: string; metadata: unknown }>) {
  const lines = ["phone,name,email,company,whatsappConsent,consentSource,consentedAt"];
  for (const row of rows) {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
    const consent = metadata.rocketSenderContact && typeof metadata.rocketSenderContact === "object" ? metadata.rocketSenderContact as Record<string, unknown> : {};
    const evidence = metadata.companyNameEvidence && typeof metadata.companyNameEvidence === "object" ? metadata.companyNameEvidence as Record<string, unknown> : {};
    const company = typeof evidence.name === "string" ? evidence.name : typeof consent.company === "string" ? consent.company : "";
    // Phone numbers have already been normalized to '+' followed by digits; keep
    // the E.164 prefix intact for RocketSender's import instead of spreadsheet escaping.
    lines.push([`"${row.phone}"`, row.name, row.email, company, "true", consent.consentSource, consent.consentedAt].map((value, index) => index === 0 ? value : csvCell(value)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

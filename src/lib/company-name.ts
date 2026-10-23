import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
function normalizeRocketPhone(value: string) {
  const digits = value.replace(/@(c\.us|s\.whatsapp\.net)$/, "").replace(/[+\s().-]/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("INVALID_INTERNATIONAL_PHONE");
  return "+" + digits;
}

export type CompanyCandidate = { name: string; phone: string; sourceUrl: string; provider: "wikidata" };
const audience = "owly-public-company-name";
const signingKey = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET required");
  return createHmac("sha256", process.env.JWT_SECRET).update(audience).digest("hex");
};
export function candidateToken(customerId: string, candidate: CompanyCandidate) {
  return jwt.sign({ customerId, candidate }, signingKey(), { audience, algorithm: "HS256", expiresIn: "15m" });
}
export function verifyCandidate(token: string, customerId: string, phone: string): CompanyCandidate | null {
  try {
    const data = jwt.verify(token, signingKey(), { audience, algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (data.customerId !== customerId || data.candidate?.phone !== normalizeRocketPhone(phone)) return null;
    return data.candidate;
  } catch { return null; }
}

// Exact telephone matches on public business entities only. No private-person
// lookup, customer messages, or guessed owner names are used as evidence.
export async function lookupPublicCompany(input: string): Promise<CompanyCandidate[]> {
  return (await lookupPublicCompanies([input])).get(normalizeRocketPhone(input)) || [];
}

export async function lookupPublicCompanies(inputs: string[]): Promise<Map<string, CompanyCandidate[]>> {
  const numbers = [...new Set(inputs.map(normalizeRocketPhone))];
  if (!numbers.length) return new Map();
  if (numbers.length > 250) throw new Error("TOO_MANY_COMPANY_LOOKUPS");
  const digitToPhone = new Map(numbers.map(phone => [phone.slice(1), phone]));
  const values = [...digitToPhone.keys()].map(digits => `"${digits}"`).join(" ");
  const query = `SELECT DISTINCT ?digits ?company ?companyLabel ?tel WHERE {
    VALUES ?digits { ${values} }
    ?company wdt:P1329 ?tel .
    FILTER(REPLACE(STR(?tel), "[^0-9]", "") = ?digits)
    FILTER EXISTS { ?company wdt:P31/wdt:P279* wd:Q4830453 }
    FILTER NOT EXISTS { ?company wdt:P31/wdt:P279* wd:Q5 }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "hu,en". }
  } LIMIT 1250`;
  const response = await fetch("https://query.wikidata.org/sparql?" + new URLSearchParams({ query, format: "json" }), {
    headers: { Accept: "application/sparql-results+json", "User-Agent": "OwlyCompanyLookup/0.1 (https://github.com/pbalazs91/owly)" },
    cache: "no-store", signal: AbortSignal.timeout(12000), redirect: "error",
  });
  if (!response.ok) throw new Error("PUBLIC_COMPANY_SOURCE_UNAVAILABLE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("PUBLIC_COMPANY_SOURCE_UNAVAILABLE");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 100000) { await reader.cancel(); throw new Error("PUBLIC_COMPANY_SOURCE_TOO_LARGE"); }
    chunks.push(value);
  }
  const rows = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.results?.bindings;
  if (!Array.isArray(rows)) throw new Error("INVALID_COMPANY_SOURCE");
  const result = new Map<string, CompanyCandidate[]>();
  for (const row of rows.slice(0, 1250)) {
    const digits = row.digits?.value;
    const phone = typeof digits === "string" ? digitToPhone.get(digits) : undefined;
    if (!phone) continue;
    const id = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/.exec(row.company?.value || "")?.[1];
    const name = row.companyLabel?.value;
    if (!id || typeof name !== "string" || !name.trim() || name === id || name.length > 200) continue;
    try { if (normalizeRocketPhone(row.tel?.value || "") !== phone) continue; } catch { continue; }
    const candidates = result.get(phone) || [];
    if (candidates.length < 5 && !candidates.some(item => item.sourceUrl.endsWith("/" + id))) candidates.push({ name: name.trim(), phone, sourceUrl: "https://www.wikidata.org/wiki/" + id, provider: "wikidata" });
    result.set(phone, candidates);
  }
  return result;
}

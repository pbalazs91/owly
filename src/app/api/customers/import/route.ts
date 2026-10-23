import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { logger } from "@/lib/logger";

const rowSchema = z.object({
  name: z.string().max(200).default(""), company: z.string().max(200).default(""), companyName: z.string().max(200).default(""),
  businessType: z.string().max(200).default(""), companyAddress: z.string().max(500).default(""), website: z.string().max(2048).default(""), email: z.string().max(254).default(""),
  phone: z.string().max(100).default(""), whatsapp: z.string().max(100).default(""), tags: z.string().max(1000).default(""),
});

function normalizePhone(value: string) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error("INVALID_PHONE");
  return "+" + digits;
}

function tagsMerge(existing: string, imported: string) {
  const tags = new Map<string, string>();
  for (const tag of existing.split(",").map(item => item.trim()).filter(Boolean)) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  for (const tag of imported.split(",").map(item => item.trim()).filter(Boolean)) if (tag.toLowerCase() !== "active" && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  return [...tags.values()].join(", ");
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "customers:create");
  if (!isAuthenticated(auth)) return auth;
  try {
    const body = await request.json();
    const parsed = z.object({ contacts: z.array(rowSchema).min(1).max(250) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "A kontaktlista hibás, vagy legfeljebb 250 sort tartalmazhat." }, { status: 400 });
    const normalized = parsed.data.contacts.map(row => {
      const website = row.website.trim();
      if (website) {
        let parsedWebsite: URL;
        try { parsedWebsite = new URL(website); } catch { throw new Error("INVALID_WEBSITE"); }
        if (!["http:", "https:"].includes(parsedWebsite.protocol)) throw new Error("INVALID_WEBSITE");
      }
      return { ...row, companyName: row.companyName.trim() || row.company.trim(), businessType: row.businessType.trim(), companyAddress: row.companyAddress.trim(), website, phone: normalizePhone(row.phone), whatsapp: normalizePhone(row.whatsapp), email: row.email.trim().toLowerCase() };
    });
    if (normalized.some(row => !row.phone && !row.whatsapp && !row.email)) return NextResponse.json({ error: "Minden kontakt sorában kell telefonszám, WhatsApp-szám vagy email-cím." }, { status: 400 });
    const seenKeys = new Set<string>();
    const contacts = normalized.filter(row => {
      const keys = [row.phone, row.whatsapp, row.email].filter(Boolean);
      if (keys.some(key => seenKeys.has(key))) return false;
      keys.forEach(key => seenKeys.add(key));
      return true;
    });
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.customer.findMany({
        where: { OR: [{ phone: { not: "" } }, { whatsapp: { not: "" } }, { email: { not: "" } }] },
        select: { id: true, name: true, companyName: true, businessType: true, companyAddress: true, website: true, email: true, phone: true, whatsapp: true, tags: true, metadata: true },
      });
      type ExistingCustomer = (typeof existing)[number];
      const phoneIndex = new Map<string, Map<string, ExistingCustomer>>();
      const emailIndex = new Map<string, Map<string, ExistingCustomer>>();
      const indexCustomer = (customer: ExistingCustomer) => {
        for (const value of [customer.phone, customer.whatsapp]) {
          try {
            const phone = normalizePhone(value);
            const matches = phoneIndex.get(phone) || new Map<string, ExistingCustomer>();
            matches.set(customer.id, customer);
            phoneIndex.set(phone, matches);
          } catch { /* Ignore legacy fields that are not valid phone numbers. */ }
        }
        if (customer.email) {
          const email = customer.email.toLowerCase();
          const matches = emailIndex.get(email) || new Map<string, ExistingCustomer>();
          matches.set(customer.id, customer);
          emailIndex.set(email, matches);
        }
      };
      existing.forEach(indexCustomer);
      let created = 0, updated = 0;
      const customerIds: string[] = [];
      for (const row of contacts) {
        const matchesById = new Map<string, ExistingCustomer>();
        for (const phone of [row.phone, row.whatsapp].filter(Boolean)) {
          for (const [id, customer] of phoneIndex.get(phone) || []) matchesById.set(id, customer);
        }
        if (row.email) for (const [id, customer] of emailIndex.get(row.email) || []) matchesById.set(id, customer);
        const matches = [...matchesById.values()];
        if (matches.length > 1) throw new Error("AMBIGUOUS_CUSTOMER");
        const found = matches[0];
        const oldMetadata = found?.metadata && typeof found.metadata === "object" && !Array.isArray(found.metadata) ? found.metadata as Record<string, unknown> : {};
        const metadata = { ...oldMetadata, ...(row.company ? { importedCompany: row.company } : {}), customerCsvImportedAt: new Date().toISOString() };
        if (found) {
          await tx.customer.update({ where: { id: found.id }, data: {
            ...(row.companyName && !found.companyName ? { companyName: row.companyName } : {}),
            ...(row.businessType && !found.businessType ? { businessType: row.businessType } : {}),
            ...(row.companyAddress && !found.companyAddress ? { companyAddress: row.companyAddress } : {}),
            ...(row.website && !found.website ? { website: row.website } : {}),
            ...((!found.name || found.name === "Unknown" || found.name === found.phone || found.name === found.whatsapp) && row.name ? { name: row.name } : {}),
            ...(row.email && !found.email ? { email: row.email } : {}),
            ...(row.phone && !found.phone ? { phone: row.phone } : {}),
            ...(row.whatsapp && !found.whatsapp ? { whatsapp: row.whatsapp } : {}),
            tags: tagsMerge(found.tags, row.tags), metadata,
          } });
          indexCustomer({
            ...found,
            ...(row.companyName && !found.companyName ? { companyName: row.companyName } : {}),
            ...(row.businessType && !found.businessType ? { businessType: row.businessType } : {}),
            ...(row.companyAddress && !found.companyAddress ? { companyAddress: row.companyAddress } : {}),
            ...(row.website && !found.website ? { website: row.website } : {}),
            ...((!found.name || found.name === "Unknown" || found.name === found.phone || found.name === found.whatsapp) && row.name ? { name: row.name } : {}),
            ...(row.email && !found.email ? { email: row.email } : {}),
            ...(row.phone && !found.phone ? { phone: row.phone } : {}),
            ...(row.whatsapp && !found.whatsapp ? { whatsapp: row.whatsapp } : {}),
            ...(row.tags ? { tags: tagsMerge(found.tags, row.tags) } : {}),
            metadata,
          });
          customerIds.push(found.id);
          updated++;
        } else {
          const customer = await tx.customer.create({ data: {
            name: row.name || row.phone || row.whatsapp || row.email,
            companyName: row.companyName, businessType: row.businessType, companyAddress: row.companyAddress, website: row.website,
            email: row.email, phone: row.phone, whatsapp: row.whatsapp,
            tags: tagsMerge("", row.tags), metadata: { ...metadata, importSource: "customer-csv" },
          } });
          indexCustomer({
            id: customer.id, name: row.name || row.phone || row.whatsapp || row.email,
            companyName: row.companyName, businessType: row.businessType, companyAddress: row.companyAddress,
            website: row.website, email: row.email, phone: row.phone, whatsapp: row.whatsapp,
            tags: tagsMerge("", row.tags), metadata: { ...metadata, importSource: "customer-csv" },
          } as ExistingCustomer);
          customerIds.push(customer.id);
          created++;
        }
      }
      return { created, updated, duplicates: normalized.length - contacts.length, imported: contacts.length, customerIds };
    }, { isolationLevel: "Serializable", timeout: 15000 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_WEBSITE") return NextResponse.json({ error: "A weboldal címe http:// vagy https:// kezdetű, érvényes URL legyen." }, { status: 400 });
    if (error instanceof Error && error.message === "INVALID_PHONE") return NextResponse.json({ error: "A telefonszám legyen nemzetközi formátumú, országkóddal." }, { status: 400 });
    if (error instanceof Error && error.message === "AMBIGUOUS_CUSTOMER") return NextResponse.json({ error: "Egy kontakt több meglévő ügyfélhez illeszkedik. Tisztázd az ismétlődő profilokat import előtt." }, { status: 409 });
    logger.error("Failed to import customer contacts:", error);
    return NextResponse.json({ error: "A kontaktimport nem sikerült." }, { status: 500 });
  }
}

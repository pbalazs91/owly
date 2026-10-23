import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorize, failure, json, readBody } from "@/lib/rocketsender/http";
import { normalizeRocketPhone, organizationId } from "@/lib/rocketsender/importer";
import { exportRocketContacts } from "@/lib/rocketsender/contact-file";

const contactSchema = z.object({
  phone: z.string().min(1).max(100), name: z.string().max(200).default(""),
  email: z.string().max(254).default(""), company: z.string().max(200).default(""),
  whatsappConsent: z.boolean().default(false), consentSource: z.string().max(300).default(""),
  consentedAt: z.string().max(100).default(""),
}).superRefine((contact, context) => {
  if (contact.whatsappConsent && (!contact.consentSource.trim() || !Number.isFinite(Date.parse(contact.consentedAt)) || Date.parse(contact.consentedAt) > Date.now())) {
    context.addIssue({ code: "custom", message: "Az igazolt WhatsApp-hozzájáruláshoz forrás és érvényes múltbeli dátum szükséges." });
  }
});

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const customers = await prisma.customer.findMany({ where: { isBlocked: false }, select: { phone: true, whatsapp: true, name: true, email: true, metadata: true } });
    const eligible = customers.flatMap(customer => {
      const metadata = customer.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata as Record<string, unknown> : {};
      const consent = metadata.rocketSenderContact && typeof metadata.rocketSenderContact === "object" ? metadata.rocketSenderContact as Record<string, unknown> : {};
      if (consent.whatsappConsent !== true || !(customer.whatsapp || customer.phone)) return [];
      try { return [{ ...customer, phone: normalizeRocketPhone(customer.whatsapp || customer.phone) }]; }
      catch { return []; }
    });
    return new NextResponse(exportRocketContacts(eligible), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="owly-rocketsender-active-consented.csv"',
      "Cache-Control": "no-store",
    } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readBody(request);
    const parsed = z.object({ contacts: z.array(contactSchema).min(1).max(250) }).safeParse(body);
    if (!parsed.success) return json({ error: "A kontaktlista hibás, vagy egyszerre több mint 250 sort tartalmaz." }, 400);
    const normalized = parsed.data.contacts.map(item => ({ ...item, phone: normalizeRocketPhone(item.phone) }));
    const unique = new Map(normalized.map(item => [item.phone, item]));
    const contacts = [...unique.values()];
    const summary = await prisma.$transaction(async tx => {
      const existing = await tx.customer.findMany({ where: { OR: [{ phone: { not: "" } }, { whatsapp: { not: "" } }] }, select: { id: true, name: true, phone: true, whatsapp: true, email: true, tags: true, metadata: true }, take: 5001 });
      if (existing.length > 5000) throw new Error("CUSTOMER_PHONE_BACKFILL_REQUIRED");
      let created = 0, updated = 0;
      for (const item of contacts) {
        const matches = existing.filter(customer => [customer.phone, customer.whatsapp].some(value => {
          try { return normalizeRocketPhone(value) === item.phone; } catch { return false; }
        }));
        if (matches.length > 1) throw new Error("AMBIGUOUS_EXISTING_CUSTOMER");
        const found = matches[0];
        const previousMetadata = found?.metadata && typeof found.metadata === "object" && !Array.isArray(found.metadata) ? found.metadata as Record<string, unknown> : {};
        const imported = {
          importedAt: new Date().toISOString(),
          whatsappConsent: item.whatsappConsent && !!item.consentSource && !!item.consentedAt && Number.isFinite(Date.parse(item.consentedAt)),
          consentSource: item.whatsappConsent ? item.consentSource : "",
          consentedAt: item.whatsappConsent ? item.consentedAt : "",
          company: item.company,
        };
        const customer = found
          ? await tx.customer.update({ where: { id: found.id }, data: {
              ...((!found.name || found.name === "Unknown" || found.name === item.phone) && (item.name || item.company) ? { name: item.name || item.company } : {}),
              ...(item.email && !found.email ? { email: item.email } : {}),
              phone: item.phone, whatsapp: item.phone,
              metadata: { ...previousMetadata, rocketSenderContact: imported },
            } })
          : await tx.customer.create({ data: {
              name: item.name || item.company || item.phone, phone: item.phone, whatsapp: item.phone,
              email: item.email, tags: "", metadata: { source: "rocketsender-contact-import", rocketSenderContact: imported },
            } });
        if (found) updated++; else created++;
        await tx.rocketContact.upsert({ where: { organizationId_phone: { organizationId, phone: item.phone } }, update: { customerId: customer.id }, create: { organizationId, phone: item.phone, customerId: customer.id } });
      }
      return { created, updated, duplicates: normalized.length - contacts.length };
    }, { isolationLevel: "Serializable", timeout: 15000 });
    return json({ ...summary, imported: contacts.length });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_INTERNATIONAL_PHONE") return json({ error: "Minden számhoz országkódos, nemzetközi telefonszám szükséges." }, 400);
    if (error instanceof Error && error.message === "AMBIGUOUS_EXISTING_CUSTOMER") return json({ error: "Egy szám több Owly-ügyfélhez is tartozik. Tisztázd az ismétlődő profilt import előtt." }, 409);
    return failure(error);
  }
}

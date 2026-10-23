import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { candidateToken, lookupPublicCompanies } from "@/lib/company-name";
import { readBoundedJson } from "@/lib/read-json";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "customers:create");
  if (!isAuthenticated(auth)) return auth;
  try {
    const body = await readBoundedJson(request, 32000);
    const parsed = z.object({ customerIds: z.array(z.string().min(1).max(100)).min(1).max(250) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Legfeljebb 250 importált kontakt kereshető egyszerre." }, { status: 400 });
    const customers = await prisma.customer.findMany({ where: { id: { in: [...new Set(parsed.data.customerIds)] } }, select: { id: true, phone: true, whatsapp: true, metadata: true } });
    const imported = customers.filter(customer => {
      const metadata = customer.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata as Record<string, unknown> : {};
      return typeof metadata.customerCsvImportedAt === "string";
    });
    const phoneByCustomer = new Map(imported.flatMap(customer => {
      const value = customer.whatsapp || customer.phone;
      if (!value) return [];
      const digits = value.replace(/@(c\.us|s\.whatsapp\.net)$/, "").replace(/\D/g, "");
      return /^[1-9]\d{7,14}$/.test(digits) ? [[customer.id, "+" + digits] as const] : [];
    }));
    const matchesByPhone = await lookupPublicCompanies([...phoneByCustomer.values()]);
    const matches = imported.flatMap(customer => {
      const phone = phoneByCustomer.get(customer.id);
      if (!phone) return [];
      const candidates = matchesByPhone.get(phone) || [];
      return candidates.length ? [{ customerId: customer.id, phone, candidates: candidates.map(candidate => ({ ...candidate, token: candidateToken(customer.id, candidate) })) }] : [];
    });
    return NextResponse.json({ searched: phoneByCustomer.size, matched: matches.length, matches, coverage: "wikidata-public-companies-only" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "A nyilvános céges keresés most nem érhető el. Az importált ügyféladatok ettől még megmaradtak." }, { status: 503 });
  }
}

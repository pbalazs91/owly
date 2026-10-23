import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { hasPermission } from "@/lib/rbac";
import { candidateToken, lookupPublicCompany } from "@/lib/company-name";
import { readBoundedJson } from "@/lib/read-json";

function normalizePhone(value: string) {
  const digits = value.replace(/@(c\.us|s\.whatsapp\.net)$/, "").replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? "+" + digits : "";
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "customers:update");
  if (!isAuthenticated(auth)) return auth;
  if (!hasPermission(auth.role, "customers:update")) return NextResponse.json({ error: "Nincs jogosultság." }, { status: 403 });
  try {
    const body = await readBoundedJson(request, 12000);
    const parsed = z.object({ customerIds: z.array(z.string().min(1).max(100)).min(1).max(50) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Válassz ki 1–50 ügyfelet a céges kereséshez." }, { status: 400 });
    const ids = [...new Set(parsed.data.customerIds)];
    const customers = await prisma.customer.findMany({ where: { id: { in: ids }, isBlocked: false }, select: { id: true, phone: true, whatsapp: true } });
    const searchable = customers.flatMap(customer => {
      const phone = normalizePhone(customer.phone) || normalizePhone(customer.whatsapp);
      return phone ? [{ id: customer.id, phone }] : [];
    });
    const matches: { customerId: string; phone: string; candidates: { name: string; sourceUrl: string; token: string }[] }[] = [];
    let unavailable = false;
    // Bound requests to the public lookup service so selecting a group does not
    // create a burst of hundreds of simultaneous queries.
    for (let start = 0; start < searchable.length; start += 4) {
      const batch = searchable.slice(start, start + 4);
      const results = await Promise.all(batch.map(async customer => {
        try { return { customer, candidates: await lookupPublicCompany(customer.phone) }; }
        catch { unavailable = true; return { customer, candidates: [] }; }
      }));
      for (const { customer, candidates } of results) {
        if (candidates.length) matches.push({ customerId: customer.id, phone: customer.phone, candidates: candidates.map(candidate => ({ ...candidate, token: candidateToken(customer.id, candidate) })) });
      }
    }
    return NextResponse.json({ searched: searchable.length, matched: matches.length, matches, unavailable, coverage: "wikidata-public-companies-only" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "A nyilvános céges adatforrás most nem érhető el. A kiválasztott ügyfelek adatai nem változtak." }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { hasPermission } from "@/lib/rbac";
import { candidateToken, lookupPublicCompany, verifyCandidate } from "@/lib/company-name";
import { readBoundedJson } from "@/lib/read-json";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request, "customers:update");
  if (!isAuthenticated(auth)) return auth;
  if (!hasPermission(auth.role, "customers:update")) return NextResponse.json({ error: "Nincs jogosultság." }, { status: 403 });
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return NextResponse.json({ error: "Az ügyfél nem található." }, { status: 404 });
    const phone = customer.phone || customer.whatsapp;
    if (!phone) return NextResponse.json({ error: "Az ügyfélhez nincs telefonszám." }, { status: 400 });
    const body = await readBoundedJson(request, 8192);
    if (body.action === "accept") {
      const candidate = typeof body.token === "string" ? verifyCandidate(body.token, id, phone) : null;
      if (!candidate) return NextResponse.json({ error: "A javaslat lejárt, vagy az ügyfél telefonszáma megváltozott. Keress újra." }, { status: 409 });
      const metadata = customer.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};
      await prisma.customer.update({ where: { id }, data: { name: candidate.name, metadata: { ...metadata, companyNameEvidence: { ...candidate, confirmedBy: auth.userId, confirmedAt: new Date().toISOString() } } } });
      return NextResponse.json({ ok: true });
    }
    if (body.action !== "lookup") return NextResponse.json({ error: "Ismeretlen művelet." }, { status: 400 });
    const candidates = await lookupPublicCompany(phone);
    return NextResponse.json({ candidates: candidates.map(candidate => ({ ...candidate, token: candidateToken(id, candidate) })), coverage: "wikidata-public-companies-only" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "A nyilvános céges adatforrás most nem érhető el, vagy a telefonszám nem nemzetközi formátumú. Név nem került módosításra." }, { status: 503 }); }
}

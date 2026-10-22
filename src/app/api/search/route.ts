import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { hasPermission } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!isAuthenticated(auth)) return auth;
  const term = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (term.length < 2 || term.length > 100) return NextResponse.json({ items: [] });
  const contains = { contains: term, mode: "insensitive" as const };
  try {
    const [customers, conversations, tickets] = await Promise.all([
      hasPermission(auth.role, "customers:read") ? prisma.customer.findMany({ where: { OR: [{ name: contains }, { email: contains }, { phone: contains }, { whatsapp: contains }] }, select: { id: true, name: true, phone: true, email: true }, take: 5, orderBy: { lastContact: "desc" } }) : [],
      hasPermission(auth.role, "conversations:read") ? prisma.conversation.findMany({ where: { OR: [{ customerName: contains }, { customerContact: contains }] }, select: { id: true, customerName: true, customerContact: true }, take: 5, orderBy: { updatedAt: "desc" } }) : [],
      hasPermission(auth.role, "tickets:read") ? prisma.ticket.findMany({ where: { OR: [{ title: contains }, { description: contains }] }, select: { id: true, title: true, status: true }, take: 5, orderBy: { updatedAt: "desc" } }) : [],
    ]);
    return NextResponse.json({ items: [
      ...customers.map(row => ({ id: "customer:" + row.id, kind: "Ügyfél", title: row.name, detail: row.phone || row.email, href: "/customers?customer=" + encodeURIComponent(row.id) })),
      ...conversations.map(row => ({ id: "conversation:" + row.id, kind: "Beszélgetés", title: row.customerName, detail: row.customerContact, href: "/conversations?conversation=" + encodeURIComponent(row.id) })),
      ...tickets.map(row => ({ id: "ticket:" + row.id, kind: "Jegy", title: row.title, detail: row.status, href: "/tickets?ticket=" + encodeURIComponent(row.id) })),
    ] }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "A keresés nem sikerült. Próbáld újra." }, { status: 503 }); }
}

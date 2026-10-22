import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { hasPermission } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!isAuthenticated(auth)) return auth;
  try {
    const conversationWhere = { status: "escalated" };
    const ticketWhere = { status: { in: ["open", "in_progress"] }, priority: { in: ["high", "urgent"] } };
    const [conversations, tickets, conversationCount, ticketCount] = await Promise.all([
      hasPermission(auth.role, "conversations:read") ? prisma.conversation.findMany({ where: conversationWhere, select: { id: true, customerName: true }, take: 5, orderBy: { updatedAt: "desc" } }) : [],
      hasPermission(auth.role, "tickets:read") ? prisma.ticket.findMany({ where: ticketWhere, select: { id: true, title: true }, take: 5, orderBy: { updatedAt: "desc" } }) : [],
      hasPermission(auth.role, "conversations:read") ? prisma.conversation.count({ where: conversationWhere }) : 0,
      hasPermission(auth.role, "tickets:read") ? prisma.ticket.count({ where: ticketWhere }) : 0,
    ]);
    return NextResponse.json({ total: conversationCount + ticketCount, items: [
      ...conversations.map(row => ({ id: "conversation:" + row.id, title: "Emberi segítségre vár: " + row.customerName, href: "/conversations?conversation=" + encodeURIComponent(row.id) })),
      ...tickets.map(row => ({ id: "ticket:" + row.id, title: "Sürgős jegy: " + row.title, href: "/tickets?ticket=" + encodeURIComponent(row.id) })),
    ] }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Az értesítések nem tölthetők be." }, { status: 503 }); }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isAuthenticated, requireAuth } from "@/lib/route-auth";
import { inspectNotionDatabase, syncNotionConversations, syncNotionCustomers } from "@/lib/integrations/notion";

const id = z.string().trim().max(100).regex(/^[a-zA-Z0-9-]*$/);
const configureSchema = z.object({
  token: z.string().trim().max(5000).optional(),
  databaseId: id,
  enabled: z.boolean(),
});

function safeSettings(settings: { databaseId: string; enabled: boolean; lastSyncAt: Date | null; lastSyncError: string; token: string; syncOffset: number; conversationSyncOffset: number } | null) {
  return {
    databaseId: settings?.databaseId || "",
    enabled: settings?.enabled || false,
    hasToken: !!settings?.token,
    lastSyncAt: settings?.lastSyncAt?.toISOString() || null,
    lastSyncError: settings?.lastSyncError || "",
    syncOffset: settings?.syncOffset || 0,
    conversationSyncOffset: settings?.conversationSyncOffset || 0,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "channels:read");
  if (!isAuthenticated(auth)) return auth;
  const settings = await prisma.notionIntegration.findUnique({ where: { id: "default" } });
  return NextResponse.json({ settings: safeSettings(settings) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;
  const parsed = configureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ellenőrizd a Notion-beállításokat." }, { status: 400 });
  const previous = await prisma.notionIntegration.findUnique({ where: { id: "default" } });
  const token = parsed.data.token?.trim() || previous?.token || "";
  const databaseId = parsed.data.databaseId.trim();
  const resetProgress = !!previous && previous.databaseId !== databaseId;
  if (parsed.data.enabled && (!token || !databaseId)) return NextResponse.json({ error: "Bekapcsoláshoz API-kulcs és adatbázis-azonosító szükséges." }, { status: 409 });
  if (parsed.data.enabled) {
    try { await inspectNotionDatabase(token, databaseId); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "A Notion-kapcsolat nem ellenőrizhető." }, { status: 422 }); }
  }
  const settings = await prisma.notionIntegration.upsert({
    where: { id: "default" },
    create: { id: "default", token, databaseId, enabled: parsed.data.enabled, lastSyncError: "" },
    update: { token, databaseId, enabled: parsed.data.enabled, lastSyncError: "", ...(resetProgress ? { syncOffset: 0, conversationSyncOffset: 0, lastSyncAt: null } : {}) },
  });
  return NextResponse.json({ ok: true, settings: safeSettings(settings) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;
  const body = await request.json().catch(() => null) as { action?: string } | null;
  const settings = await prisma.notionIntegration.findUnique({ where: { id: "default" } });
  if (!settings?.token || !settings.databaseId) return NextResponse.json({ error: "Előbb mentsd el a Notion API-kulcsot és az adatbázis-azonosítót." }, { status: 409 });
  if (body?.action === "test") {
    try {
      await inspectNotionDatabase(settings.token, settings.databaseId);
      return NextResponse.json({ ok: true, message: "A Notion-kapcsolat és az Owly ID oszlop rendben van." });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "A Notion-kapcsolat nem ellenőrizhető." }, { status: 422 });
    }
  }
  if (body?.action !== "sync") return NextResponse.json({ error: "Ismeretlen művelet." }, { status: 400 });
  if (!settings.enabled) return NextResponse.json({ error: "Előbb kapcsold be a Notion-szinkront." }, { status: 409 });
  try {
    const [customerTotal, conversationTotal] = await Promise.all([prisma.customer.count(), prisma.conversation.count()]);
    const customerOffset = settings.syncOffset >= customerTotal ? 0 : settings.syncOffset;
    const conversationOffset = settings.conversationSyncOffset >= conversationTotal ? 0 : settings.conversationSyncOffset;
    const [customers, conversations] = await Promise.all([
      prisma.customer.findMany({ orderBy: { updatedAt: "desc" }, skip: customerOffset, take: 10 }),
      prisma.conversation.findMany({ orderBy: { updatedAt: "desc" }, skip: conversationOffset, take: 10, include: { messages: { orderBy: { createdAt: "desc" }, take: 20 } } }),
    ]);
    const customerResult = await syncNotionCustomers(settings.token, settings.databaseId, customers);
    const conversationResult = await syncNotionConversations(settings.token, settings.databaseId, conversations);
    const result = {
      created: customerResult.created + conversationResult.created,
      updated: customerResult.updated + conversationResult.updated,
      failed: customerResult.failed + conversationResult.failed,
      errors: [...customerResult.errors, ...conversationResult.errors].slice(0, 3),
    };
    const nextCustomerOffset = customerResult.failed > 0 ? customerOffset : customerOffset + customers.length >= customerTotal ? 0 : customerOffset + customers.length;
    const nextConversationOffset = conversationResult.failed > 0 ? conversationOffset : conversationOffset + conversations.length >= conversationTotal ? 0 : conversationOffset + conversations.length;
    const summary = `${result.created} új, ${result.updated} frissített, ${result.failed} hibás`;
    await prisma.notionIntegration.update({ where: { id: "default" }, data: { lastSyncAt: new Date(), lastSyncError: result.errors.join(" | "), syncOffset: nextCustomerOffset, conversationSyncOffset: nextConversationOffset } });
    return NextResponse.json({ ok: result.failed === 0, ...result, summary, hasMore: nextCustomerOffset > 0 || nextConversationOffset > 0, nextOffset: nextCustomerOffset, nextConversationOffset }, { status: result.failed === 0 ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A Notion-szinkron sikertelen.";
    await prisma.notionIntegration.update({ where: { id: "default" }, data: { lastSyncAt: new Date(), lastSyncError: message } }).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorize, failure, json, readBody } from "@/lib/rocketsender/http";
import { drainRocketQueue, enqueueReply, normalizeRocketPhone, organizationId, replySchema } from "@/lib/rocketsender/importer";

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const [settings, events, dead, pending, sent] = await Promise.all([
      prisma.rocketIntegration.findUnique({ where: { id: "default" } }),
      prisma.rocketImportEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, attempts: true, lastErrorCode: true, createdAt: true, customerId: true, conversationId: true } }),
      prisma.rocketImportEvent.count({ where: { organizationId, status: "dead" } }),
      prisma.rocketImportEvent.count({ where: { organizationId, status: { in: ["pending", "processing"] } } }),
      prisma.rocketOutbound.count({ where: { organizationId } }),
    ]);
    return json({ settings: settings || { mode: "disabled", accountId: "", trialPhone: "", compatibilityVerified: false, aiSuggestions: false }, events, dead, pending, sent, autoSend: false, nativeRocketWebhookVerified: false });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readBody(request);
    if (body.action === "drain") { await drainRocketQueue(); return json({ ok: true }); }
    // Browser bridge tokens can only submit replies/check/retry the durable queue.
    const settingsAuth = await authorize(request);
    if (settingsAuth instanceof NextResponse) return settingsAuth;
    if (body.action === "configure") {
      const parsed = z.object({ mode: z.enum(["disabled", "trial", "active"]), accountId: z.string().max(100), trialPhone: z.string().max(100).default(""), aiSuggestions: z.boolean().default(false) }).safeParse(body);
      if (!parsed.success) return json({ error: "Hibás beállítás." }, 400);
      let accountId = "", trialPhone = "";
      try { accountId = normalizeRocketPhone(parsed.data.accountId); if (parsed.data.trialPhone) trialPhone = normalizeRocketPhone(parsed.data.trialPhone); }
      catch { return json({ error: "Nemzetközi telefonszámot adj meg, országkóddal." }, 400); }
      if (parsed.data.mode === "trial" && !trialPhone) return json({ error: "Próba módban szükséges a tesztszám." }, 400);
      if (trialPhone && accountId === trialPhone) return json({ error: "A próbához a saját WhatsApp-fióktól eltérő tesztszám kell." }, 400);
      const previous = await prisma.rocketIntegration.findUnique({ where: { id: "default" } });
      const verified = !!previous?.compatibilityVerified && previous.accountId === accountId && previous.trialPhone === trialPhone;
      if (parsed.data.mode === "active" && !verified) return json({ error: "Előbb igazold a tesztválasz fogadását és a duplikációpróbát." }, 409);
      const data = { mode: parsed.data.mode, accountId, trialPhone, compatibilityVerified: verified, aiSuggestions: parsed.data.aiSuggestions };
      await prisma.rocketIntegration.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
      return json({ ok: true });
    }
    if (body.action === "verify") {
      if (body.confirmed !== true) return json({ error: "A valódi RocketSender-tesztet neked kell ellenőrizned." }, 400);
      const settings = await prisma.rocketIntegration.findUnique({ where: { id: "default" } });
      if (settings?.mode !== "trial") return json({ error: "Előbb állíts be próba módot." }, 409);
      const event = await prisma.rocketImportEvent.findFirst({ where: { organizationId, accountId: settings.accountId, status: "processed", payload: { path: ["phone"], equals: settings.trialPhone }, customerId: { not: null }, conversationId: { not: null } }, orderBy: { createdAt: "desc" } });
      if (!event) return json({ error: "Még nem érkezett sikeresen importált tesztválasz." }, 409);
      const result = await enqueueReply(replySchema.parse(event.payload));
      if (!("duplicate" in result) || !result.duplicate) return json({ error: "A duplikációpróba nem sikerült." }, 409);
      await prisma.rocketIntegration.update({ where: { id: "default" }, data: { compatibilityVerified: true } });
      return json({ ok: true, duplicateIgnored: true });
    }
    if (body.action === "retry" && typeof body.eventId === "string") {
      await prisma.rocketImportEvent.updateMany({ where: { id: body.eventId, organizationId, status: "dead" }, data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lockedAt: null } });
      await drainRocketQueue(); return json({ ok: true });
    }
    return json({ error: "Ismeretlen művelet." }, 400);
  } catch (error) { return failure(error); }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const inputSchema = z.object({
  fallbackEnabled: z.boolean(),
  fallbackProvider: z.enum(["infobip", "peach", "respondio"]),
  infobip: z.object({
    baseUrl: z.string().max(300),
    sender: z.string().max(100),
    apiKey: z.string().max(500).optional(),
    webhookToken: z.string().max(200).optional(),
  }),
  respondio: z.object({
    enabled: z.boolean(),
    channelId: z.string().max(30).refine(value => value === "" || (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)))),
    apiKey: z.string().max(2000).optional(),
    signingKey: z.string().max(500).optional(),
  }).optional(),
  peach: z.object({
    flowId: z.string().max(100),
    apiKey: z.string().max(500).optional(),
    webhookToken: z.string().max(200).optional(),
  }),
});

function safeView(config: Record<string, unknown>) {
  const providers = (config.providerSettings || {}) as Record<string, Record<string, unknown>>;
  const infobip = providers.infobip || {};
  const peach = providers.peach || {};
  const respondio = providers.respondio || {};
  return {
    fallbackEnabled: config.fallbackEnabled === true,
    fallbackProvider: config.fallbackProvider === "respondio" ? "respondio" : config.fallbackProvider === "peach" ? "peach" : "infobip",
    respondio: { enabled: respondio.enabled === true, channelId: text(respondio.channelId), hasApiKey: !!text(respondio.apiKey), hasSigningKey: !!text(respondio.signingKey) },
    infobip: {
      baseUrl: text(infobip.baseUrl),
      sender: text(infobip.sender),
      hasApiKey: !!text(infobip.apiKey),
      hasWebhookToken: !!text(infobip.webhookToken),
    },
    peach: {
      flowId: text(peach.flowId),
      hasApiKey: !!text(peach.apiKey),
      hasWebhookToken: !!text(peach.webhookToken),
    },
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "channels:read");
  if (!isAuthenticated(auth)) return auth;
  const channel = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
  const config = (channel?.config || {}) as Record<string, unknown>;
  const fallbacks = await prisma.whatsAppFallback.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, customerContact: true, fallbackProvider: true, status: true, dueAt: true, createdAt: true, lastErrorCode: true },
  });
  return NextResponse.json({
    settings: safeView(config),
    fallbacks,
    webhooks: {
      respondio: new URL("/api/integrations/whatsapp/respondio/inbound", request.nextUrl.origin).toString(),
      infobip: new URL("/api/integrations/whatsapp/infobip/inbound", request.nextUrl.origin).toString(),
      peach: new URL("/api/integrations/whatsapp/peach/inbound", request.nextUrl.origin).toString(),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Hibás kérés." }, { status: 400 }); }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Ellenőrizd a beállítások mezőit." }, { status: 400 });

  const old = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
  const previous = (old?.config || {}) as Record<string, unknown>;
  const providers = (previous.providerSettings || {}) as Record<string, Record<string, unknown>>;
  const oldInfobip = providers.infobip || {};
  const oldPeach = providers.peach || {};
  const value = parsed.data;
  const infobip = {
    baseUrl: value.infobip.baseUrl.trim().replace(/\/+$/, ""),
    sender: value.infobip.sender.trim(),
    apiKey: value.infobip.apiKey?.trim() || text(oldInfobip.apiKey),
    webhookToken: value.infobip.webhookToken?.trim() || text(oldInfobip.webhookToken),
  };
  const peach = {
    flowId: value.peach.flowId.trim(),
    apiKey: value.peach.apiKey?.trim() || text(oldPeach.apiKey),
    webhookToken: value.peach.webhookToken?.trim() || text(oldPeach.webhookToken),
  };
  const oldRespondio = providers.respondio || {};
  const respondio = value.respondio ? {
    enabled: value.respondio.enabled,
    channelId: value.respondio.channelId,
    apiKey: value.respondio.apiKey?.trim() || text(oldRespondio.apiKey),
    signingKey: value.respondio.signingKey?.trim() || text(oldRespondio.signingKey),
  } : { enabled: oldRespondio.enabled === true, channelId: text(oldRespondio.channelId), apiKey: text(oldRespondio.apiKey), signingKey: text(oldRespondio.signingKey) };
  const respondioReady = !!(respondio.enabled && respondio.channelId && respondio.apiKey && respondio.signingKey);
  if (respondio.enabled && !respondioReady) return NextResponse.json({ error: "A respond.io bekapcsolásához add meg a WhatsApp-csatorna azonosítóját, az API-kulcsot és a webhook aláírókulcsát." }, { status: 409 });
  if (value.fallbackEnabled) {
    const ready = value.fallbackProvider === "respondio" ? respondioReady : value.fallbackProvider === "infobip"
      ? !!(infobip.baseUrl && infobip.sender && infobip.apiKey && infobip.webhookToken)
      : !!(peach.apiKey && peach.flowId && peach.webhookToken);
    if (!ready) return NextResponse.json({ error: "A kiválasztott tartalékszolgáltató API-adatait előbb mentsd el." }, { status: 409 });
  }
  const config = {
    ...previous,
    providerSettings: { ...providers, infobip, peach, respondio },
    fallbackEnabled: value.fallbackEnabled,
    fallbackProvider: value.fallbackProvider,
  };
  await prisma.channel.upsert({
    where: { type: "whatsapp" },
    update: { config },
    create: { type: "whatsapp", config, isActive: false, status: "disconnected" },
  });
  return NextResponse.json({ ok: true, settings: safeView(config) }, { headers: { "Cache-Control": "no-store" } });
}

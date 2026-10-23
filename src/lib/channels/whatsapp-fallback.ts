import { prisma } from "@/lib/prisma";
import { sendInfobipText, sendPeachAppMessage, type ProviderSendResult } from "@/lib/channels/whatsapp-providers";

const FALLBACK_DELAY_MS = 15 * 60 * 1000;

type Provider = "infobip" | "peach";
type WhatsAppConfig = Record<string, unknown> & {
  providerSettings?: Record<string, unknown>;
  fallbackProvider?: unknown;
  fallbackEnabled?: unknown;
};

function isProvider(value: unknown): value is Provider {
  return value === "infobip" || value === "peach";
}

export async function scheduleWhatsAppFallback(input: {
  inboundMessageId: string;
  conversationId: string;
  customerContact: string;
  fallbackProvider?: Provider;
}) {
  const channel = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
  const config = (channel?.config || {}) as WhatsAppConfig;
  const provider = input.fallbackProvider || (isProvider(config.fallbackProvider) ? config.fallbackProvider : null);
  if (!config.fallbackEnabled || !provider) return;
  await prisma.whatsAppFallback.upsert({
    where: { inboundMessageId: input.inboundMessageId },
    update: {},
    create: {
      inboundMessageId: input.inboundMessageId,
      conversationId: input.conversationId,
      customerContact: input.customerContact,
      fallbackProvider: provider,
      dueAt: new Date(Date.now() + FALLBACK_DELAY_MS),
    },
  });
}

export async function saveWhatsAppDraft(inboundMessageId: string, content: string) {
  if (!content.trim()) return;
  await prisma.whatsAppFallback.updateMany({
    where: { inboundMessageId, status: "pending" },
    data: { replyContent: content.trim().slice(0, 6000) },
  });
}

export async function markWhatsAppReplySent(inboundMessageId: string, providerMessageId = "") {
  await prisma.whatsAppFallback.updateMany({
    where: { inboundMessageId, status: { in: ["pending", "sending"] } },
    data: { status: "sent", providerMessageId, lockedAt: null, lastErrorCode: "" },
  });
}

export async function markWhatsAppReplyUncertain(inboundMessageId: string) {
  await prisma.whatsAppFallback.updateMany({
    where: { inboundMessageId, status: { in: ["pending", "processing", "sending"] } },
    data: { status: "uncertain", lockedAt: null, lastErrorCode: "owly_send_result_unknown" },
  });
}

/**
 * Drains due fallback records. The compare-and-set claim prevents two
 * simultaneous extension heartbeats from sending the same reply twice.
 */
export async function processDueWhatsAppFallbacks(now = new Date(), limit = 10) {
  const due = await prisma.whatsAppFallback.findMany({
    where: { status: "pending", dueAt: { lte: now }, replyContent: { not: "" } },
    orderBy: { dueAt: "asc" },
    take: Math.max(1, Math.min(limit, 50)),
  });
  let processed = 0;
  for (const item of due) {
    const claim = await prisma.whatsAppFallback.updateMany({
      where: { id: item.id, status: "pending", dueAt: { lte: now } },
      data: { status: "processing", lockedAt: now },
    });
    if (claim.count !== 1) continue;
    processed++;

    const channel = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
    const config = (channel?.config || {}) as WhatsAppConfig;
    const settings = (config.providerSettings || {}) as Record<string, Record<string, unknown>>;
    let result: ProviderSendResult;
    try {
      if (item.fallbackProvider === "infobip") {
        const value = settings.infobip || {};
        result = await sendInfobipText({
          baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
          apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
          sender: typeof value.sender === "string" ? value.sender : "",
        }, item.customerContact, item.replyContent);
      } else if (item.fallbackProvider === "peach") {
        const value = settings.peach || {};
        result = await sendPeachAppMessage({
          apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
          flowId: typeof value.flowId === "string" ? value.flowId : "",
        }, item.customerContact, item.replyContent);
      } else {
        result = { outcome: "rejected", code: "provider_not_supported" };
      }
    } catch {
      result = { outcome: "uncertain", code: "provider_call_failed" };
    }

    if (result.outcome === "accepted") {
      await prisma.whatsAppFallback.update({
        where: { id: item.id },
        data: {
          status: "fallback_sent",
          providerMessageId: result.providerMessageId,
          lockedAt: null,
          lastErrorCode: "",
        },
      });
      const fallbackMessageId = "provider-fallback-" + item.id;
      const message = await prisma.message.upsert({
        where: { id: fallbackMessageId },
        update: {},
        create: {
          id: fallbackMessageId,
          conversationId: item.conversationId,
          role: "assistant",
          content: item.replyContent,
          toolCalls: { provider: item.fallbackProvider, providerMessageId: result.providerMessageId, fallback: true },
        },
      });
      const { emitNewMessage } = await import("@/lib/realtime");
      emitNewMessage(item.conversationId, { id: message.id, role: "assistant", content: message.content });
      continue;
    }

    // Never switch again after an unknown result: provider acceptance may have
    // happened even if its acknowledgement was lost.
    await prisma.whatsAppFallback.update({
      where: { id: item.id },
      data: {
        status: result.outcome === "uncertain" ? "uncertain" : "failed",
        lockedAt: null,
        lastErrorCode: result.code,
      },
    });
  }
  return processed;
}

export async function canSendOwlyReply(inboundMessageId: string) {
  await processDueWhatsAppFallbacks();
  const item = await prisma.whatsAppFallback.findUnique({ where: { inboundMessageId }, select: { id: true, status: true } });
  if (!item) return true;
  if (item.status !== "pending") return false;
  const claim = await prisma.whatsAppFallback.updateMany({
    where: { id: item.id, status: "pending" },
    data: { status: "sending" },
  });
  return claim.count === 1;
}

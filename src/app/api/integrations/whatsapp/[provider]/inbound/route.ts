import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emitNewMessage } from "@/lib/realtime";
import { resolveCustomer } from "@/lib/customer-resolver";
import { parseInfobipInbound, parsePeachReply } from "@/lib/channels/whatsapp-providers";

type Provider = "infobip" | "peach";
type Context = { params: Promise<{ provider: string }> };

function equalSecret(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const stableId = (provider: string, externalId: string) =>
  "prov-" + createHash("sha256").update(provider + ":" + externalId).digest("hex");

export async function POST(request: NextRequest, context: Context) {
  const { provider: rawProvider } = await context.params;
  if (rawProvider !== "infobip" && rawProvider !== "peach") {
    return NextResponse.json({ error: "Ismeretlen szolgáltató." }, { status: 404 });
  }
  const provider = rawProvider as Provider;
  const channel = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
  const config = (channel?.config || {}) as Record<string, unknown>;
  const providers = (config.providerSettings || {}) as Record<string, Record<string, unknown>>;
  const secret = typeof providers[provider]?.webhookToken === "string" ? providers[provider].webhookToken as string : "";
  if (!secret) return NextResponse.json({ error: "A webhook hitelesítése nincs beállítva." }, { status: 503 });
  const authorization = request.headers.get("authorization") || "";
  const supplied = request.headers.get("x-owly-webhook-token") ||
    (authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (!equalSecret(supplied, secret)) return NextResponse.json({ error: "Érvénytelen webhook-hitelesítés." }, { status: 401 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Hibás JSON." }, { status: 400 }); }
  const events = provider === "infobip" ? parseInfobipInbound(payload) : parsePeachReply(payload);
  if (events.length === 0) return NextResponse.json({ accepted: true, imported: 0 });

  let imported = 0;
  for (const event of events) {
    let log;
    try {
      log = await prisma.whatsAppProviderEvent.create({
        data: { provider, externalEventId: event.eventId, status: "processing" },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        const existing = await prisma.whatsAppProviderEvent.findUnique({
          where: { provider_externalEventId: { provider, externalEventId: event.eventId } },
        });
        if (!existing || existing.status === "processed") continue;
        const staleProcessing = ["processing", "retrying"].includes(existing.status) &&
          Date.now() - existing.updatedAt.getTime() > 5 * 60 * 1000;
        if (existing.status !== "failed" && !staleProcessing) continue;
        const claimed = await prisma.whatsAppProviderEvent.updateMany({
          where: { id: existing.id, status: existing.status },
          data: { status: staleProcessing ? "retrying" : "processing", lastErrorCode: "" },
        });
        if (claimed.count !== 1) continue;
        log = { id: existing.id };
      }
      else throw error;
    }
    try {
      const customerId = await resolveCustomer("whatsapp", event.phone, event.name);
      let conversation = await prisma.conversation.findFirst({
        where: {
          channel: "whatsapp",
          status: { in: ["active", "escalated"] },
          OR: [{ customerId }, { customerContact: event.phone }],
        },
        orderBy: { updatedAt: "desc" },
      });
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            channel: "whatsapp",
            customerName: event.name || "Unknown",
            customerContact: event.phone,
            customerId,
            metadata: { whatsappProvider: provider },
          },
        });
      } else {
        const metadata = (conversation.metadata || {}) as Record<string, unknown>;
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { metadata: { ...metadata, whatsappProvider: provider }, updatedAt: event.sentAt },
        });
      }
      const messageId = stableId(provider, event.messageId);
      const message = await prisma.message.upsert({
        where: { id: messageId },
        update: {},
        create: {
          id: messageId,
          conversationId: conversation.id,
          role: "customer",
          content: event.text,
          createdAt: event.sentAt,
          toolCalls: { externalMessageId: event.messageId, provider },
        },
      });
      await prisma.whatsAppProviderEvent.update({
        where: { id: log.id },
        data: { status: "processed", conversationId: conversation.id, messageId: message.id },
      });
      emitNewMessage(conversation.id, { id: message.id, role: "customer", content: message.content });
      imported++;
    } catch (error) {
      await prisma.whatsAppProviderEvent.update({
        where: { id: log.id },
        data: { status: "failed", lastErrorCode: (error as { code?: string }).code || "processing_error" },
      });
      throw error;
    }
  }
  return NextResponse.json({ accepted: true, imported });
}

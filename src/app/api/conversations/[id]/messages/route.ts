import { sendRespondioText } from "@/lib/channels/respondio";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { emitNewMessage } from "@/lib/realtime";
import { sendInfobipText, sendPeachAppMessage, type ProviderSendResult } from "@/lib/channels/whatsapp-providers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, "messages:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(messages);
  } catch (error) {
    logger.error("Failed to fetch messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, "messages:create");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { content, role } = body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { error: "Message content is required" },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const validRoles = ["customer", "assistant", "system"];
    const messageRole = validRoles.includes(role) ? role : "assistant";

    let delivery: ProviderSendResult | null = null;
    let provider: "infobip" | "peach" | "respondio" | null = null;
    if (messageRole === "assistant" && conversation.channel === "whatsapp") {
      const metadata = (conversation.metadata || {}) as Record<string, unknown>;
      const configRow = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
      const config = (configRow?.config || {}) as Record<string, unknown>;
      const providerSettings = (config.providerSettings || {}) as Record<string, Record<string, unknown>>;
      const candidate = metadata.whatsappProvider || (config.mode === "respondio" && !configRow?.isActive ? null : config.primaryProvider);
      if (config.mode === "respondio" && !configRow?.isActive && candidate === "respondio") {
        return NextResponse.json({ error: "A respond.io elsődleges csatorna ki van kapcsolva." }, { status: 409 });
      }
      if (config.mode === "respondio" && !configRow?.isActive && !metadata.whatsappProvider) {
        return NextResponse.json({ error: "A respond.io elsődleges csatorna ki van kapcsolva." }, { status: 409 });
      }
      if (candidate === "infobip" || candidate === "peach" || candidate === "respondio") {
        provider = candidate;
        try {
          if (provider === "infobip") {
            const value = providerSettings.infobip || {};
            delivery = await sendInfobipText({
              baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
              apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
              sender: typeof value.sender === "string" ? value.sender : "",
            }, conversation.customerContact, content.trim());
          } else if (provider === "respondio") {
            const value = providerSettings.respondio || {};
            delivery = value.enabled === true ? await sendRespondioText({
              apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
              channelId: typeof value.channelId === "string" ? value.channelId : "",
            }, conversation.customerContact, content.trim()) : { outcome: "rejected", code: "provider_disabled" };
          } else {
            const value = providerSettings.peach || {};
            delivery = await sendPeachAppMessage({
              apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
              flowId: typeof value.flowId === "string" ? value.flowId : "",
            }, conversation.customerContact, content.trim());
          }
        } catch {
          delivery = { outcome: "uncertain", code: "provider_call_failed" };
        }
        if (delivery.outcome === "rejected") {
          return NextResponse.json(
            { error: "A WhatsApp-szolgáltató elutasította a küldést. Kód: " + delivery.code, delivery: "rejected" },
            { status: 502 }
          );
        }
        if (delivery.outcome === "uncertain") {
          return NextResponse.json(
            { error: "A küldés eredménye bizonytalan; ne küldd el újra, amíg nem ellenőrizted a szolgáltató kimenő naplóját.", delivery: "uncertain" },
            { status: 409 }
          );
        }
      }
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        role: messageRole,
        content: content.trim(),
        ...(delivery?.outcome === "accepted" && provider ? {
          toolCalls: { provider, providerMessageId: delivery.providerMessageId, delivery: "accepted" },
        } : {}),
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    emitNewMessage(id, { id: message.id, role: messageRole, content: content.trim() });

    return NextResponse.json({ ...message, ...(delivery ? { delivery: delivery.outcome, provider } : {}) }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create message:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}

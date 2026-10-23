import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";

const CHANNEL_TYPES = ["whatsapp", "email", "phone", "sms", "telegram"];

function publicChannel(channel: { config: unknown; [key: string]: unknown }) {
  const config = { ...((channel.config || {}) as Record<string, unknown>) };
  const providers = (config.providerSettings || {}) as Record<string, Record<string, unknown>>;
  if (config.providerSettings) {
    config.providerSettings = {
      respondio: {
        enabled: providers.respondio?.enabled === true,
        channelId: providers.respondio?.channelId || "",
        hasApiKey: !!providers.respondio?.apiKey,
        hasSigningKey: !!providers.respondio?.signingKey,
      },
      infobip: {
        baseUrl: providers.infobip?.baseUrl || "",
        sender: providers.infobip?.sender || "",
        hasApiKey: typeof providers.infobip?.apiKey === "string" && !!providers.infobip.apiKey,
        hasWebhookToken: typeof providers.infobip?.webhookToken === "string" && !!providers.infobip.webhookToken,
      },
      peach: {
        flowId: providers.peach?.flowId || "",
        hasApiKey: typeof providers.peach?.apiKey === "string" && !!providers.peach.apiKey,
        hasWebhookToken: typeof providers.peach?.webhookToken === "string" && !!providers.peach.webhookToken,
      },
    };
  }
  return { ...channel, config };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "channels:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    const channels = await prisma.channel.findMany({
      orderBy: { type: "asc" },
    });

    const channelMap = new Map(channels.map((ch) => [ch.type, ch]));
    const result = CHANNEL_TYPES.map((type) => {
      const existing = channelMap.get(type);
      if (existing) {
        const config = existing.config as Record<string, unknown>;
        if (type === "whatsapp" && config.mode === "api") {
          return publicChannel({ ...existing, status: "disconnected", isActive: false });
        }
        if (config.mode === "browser" && (typeof config.browserLastSeen !== "string" || Date.now() - Date.parse(config.browserLastSeen) > 90000)) {
          return publicChannel({ ...existing, status: "disconnected", isActive: false });
        }
        return publicChannel(existing as unknown as { config: unknown; [key: string]: unknown });
      }
      return {
        id: null,
        type,
        isActive: false,
        config: {},
        status: "disconnected",
        createdAt: null,
        updatedAt: null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Failed to fetch channels:", error);
    return NextResponse.json(
      { error: "Failed to fetch channels" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;

  try {
    const body = await request.json();
    const { type, isActive, config } = body;

    if (!type || !CHANNEL_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Invalid channel type. Must be one of: " + CHANNEL_TYPES.join(", ") },
        { status: 400 }
      );
    }

    const existing = await prisma.channel.findUnique({ where: { type } });
    let mergedConfig = config;
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const oldConfig = (existing?.config || {}) as Record<string, unknown>;
      mergedConfig = {
        ...oldConfig,
        ...(config as Record<string, unknown>),
        ...(oldConfig.providerSettings ? { providerSettings: oldConfig.providerSettings } : {}),
      };
    }
    const channel = await prisma.channel.upsert({
      where: { type },
      update: {
        isActive: typeof isActive === "boolean" ? isActive : undefined,
        config: mergedConfig ?? undefined,
      },
      create: {
        type,
        isActive: typeof isActive === "boolean" ? isActive : false,
        config: mergedConfig ?? {},
        status: "disconnected",
      },
    });

    return NextResponse.json(publicChannel(channel as unknown as { config: unknown; [key: string]: unknown }), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("Failed to save channel:", error);
    return NextResponse.json(
      { error: "Failed to save channel" },
      { status: 500 }
    );
  }
}

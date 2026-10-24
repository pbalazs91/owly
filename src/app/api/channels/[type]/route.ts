import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";

const CHANNEL_TYPES = ["whatsapp", "email", "phone", "sms", "telegram"];
function redactProviderSecrets(channel: { config: unknown; [key: string]: unknown }) {
  const config = { ...((channel.config || {}) as Record<string, unknown>) };
  const providers = (config.providerSettings || {}) as Record<string, Record<string, unknown>>;
  if (config.providerSettings) {
    config.providerSettings = {
      respondio: { enabled: providers.respondio?.enabled === true, channelId: providers.respondio?.channelId || "", hasApiKey: !!providers.respondio?.apiKey, hasSigningKey: !!providers.respondio?.signingKey },
      infobip: { baseUrl: providers.infobip?.baseUrl || "", sender: providers.infobip?.sender || "", hasApiKey: !!providers.infobip?.apiKey, hasWebhookToken: !!providers.infobip?.webhookToken },
      peach: { flowId: providers.peach?.flowId || "", hasApiKey: !!providers.peach?.apiKey, hasWebhookToken: !!providers.peach?.webhookToken },
    };
  }
  return { ...channel, config };
}

type RouteContext = { params: Promise<{ type: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth(request, "channels:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { type } = await context.params;

    if (!CHANNEL_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Invalid channel type" },
        { status: 400 }
      );
    }

    const channel = await prisma.channel.findUnique({
      where: { type },
    });

    if (!channel) {
      return NextResponse.json({
        id: null,
        type,
        isActive: false,
        config: {},
        status: "disconnected",
        createdAt: null,
        updatedAt: null,
      });
    }

    return NextResponse.json(redactProviderSecrets(channel as unknown as { config: unknown; [key: string]: unknown }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("Failed to fetch channel:", error);
    return NextResponse.json(
      { error: "Failed to fetch channel" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { type } = await context.params;

    if (!CHANNEL_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Invalid channel type" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { isActive, config, status } = body;
    const existing = await prisma.channel.findUnique({ where: { type } });
    let mergedConfig = config;
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const incomingConfig = config as Record<string, unknown>;
      const oldConfig = (existing?.config || {}) as Record<string, unknown>;
      mergedConfig = {
        ...oldConfig,
        ...incomingConfig,
        // Provider credentials are intentionally omitted from channel GET
        // responses, so preserve them when the general channel form saves.
        ...(oldConfig.providerSettings ? { providerSettings: oldConfig.providerSettings } : {}),
      };
    }

    if (type === "whatsapp" && mergedConfig && typeof mergedConfig === "object") {
      const settings = mergedConfig as Record<string, unknown>;
      settings.primaryProvider = settings.mode === "respondio" ? "respondio" : "";
      if (settings.mode === "respondio" && (typeof isActive === "boolean" ? isActive : existing?.isActive)) {
        const providers = (settings.providerSettings || {}) as Record<string, Record<string, unknown>>;
        const value = providers.respondio || {};
        if (value.enabled !== true || !value.apiKey || !value.signingKey || !value.channelId) {
          return NextResponse.json({ error: "Előbb állítsd be és engedélyezd a respond.io integrációt." }, { status: 409 });
        }
      }
    }
    const channel = await prisma.channel.upsert({
      where: { type },
      update: {
        isActive: typeof isActive === "boolean" ? isActive : undefined,
        config: mergedConfig ?? undefined,
        status: (mergedConfig as Record<string, unknown> | undefined)?.mode === "respondio" ? "disconnected" : status ?? undefined,
      },
      create: {
        type,
        isActive: typeof isActive === "boolean" ? isActive : false,
        config: mergedConfig ?? {},
        status: status ?? "disconnected",
      },
    });

    return NextResponse.json(redactProviderSecrets(channel as unknown as { config: unknown; [key: string]: unknown }));
  } catch (error) {
    logger.error("Failed to update channel:", error);
    return NextResponse.json(
      { error: "Failed to update channel" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;

  try {
    const { type } = await context.params;

    if (!CHANNEL_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Invalid channel type" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { action } = body;

    if (!action || !["connect", "disconnect", "test"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be one of: connect, disconnect, test" },
        { status: 400 }
      );
    }

    const channel = await prisma.channel.findUnique({ where: { type } });

    if (action === "disconnect") {
      const updated = await prisma.channel.upsert({
        where: { type },
        update: { status: "disconnected" },
        create: {
          type,
          isActive: false,
          config: {},
          status: "disconnected",
        },
      });
      return NextResponse.json({
        ...redactProviderSecrets(updated as unknown as { config: unknown; [key: string]: unknown }),
        message: `${type} channel disconnected`,
      });
    }

    if (action === "connect") {
      if (!channel?.config || Object.keys(channel.config as object).length === 0) {
        return NextResponse.json(
          { error: "Channel must be configured before connecting" },
          { status: 400 }
        );
      }

      const updated = await prisma.channel.update({
        where: { type },
        data: { status: "connected", isActive: true },
      });

      return NextResponse.json({
        ...redactProviderSecrets(updated as unknown as { config: unknown; [key: string]: unknown }),
        message: `${type} channel connected`,
      });
    }

    if (action === "test") {
      if (!channel?.config || Object.keys(channel.config as object).length === 0) {
        return NextResponse.json(
          { error: "Channel must be configured before testing" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `${type} connection test initiated`,
        channel: redactProviderSecrets(channel as unknown as { config: unknown; [key: string]: unknown }),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    logger.error("Failed to perform channel action:", error);
    return NextResponse.json(
      { error: "Failed to perform channel action" },
      { status: 500 }
    );
  }
}

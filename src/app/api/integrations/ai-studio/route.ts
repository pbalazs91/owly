import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { aiStudioSecretHint, createAiStudioSecret, hashAiStudioSecret } from "@/lib/integrations/ai-studio";

const integrationId = "default";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "channels:read");
  if (!isAuthenticated(auth)) return auth;

  const [integration, channel] = await Promise.all([
    prisma.aiStudioIntegration.findUnique({ where: { id: integrationId } }),
    prisma.channel.findUnique({ where: { type: "whatsapp" }, select: { isActive: true, status: true, config: true } }),
  ]);
  const config = (channel?.config || {}) as Record<string, unknown>;
  const lastSeen = typeof config.browserLastSeen === "string" ? config.browserLastSeen : "";
  const lastSeenAt = Date.parse(lastSeen);
  const connected = channel?.status === "connected" && config.browserStatus === "connected" && Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt <= 90000;

  return NextResponse.json({
    backendUrl: request.nextUrl.origin,
    healthUrl: new URL("/api/integrations/ai-studio/health", request.nextUrl.origin).toString(),
    enabled: integration?.enabled === true,
    hasSecret: !!integration?.secretHash,
    secretHint: integration?.secretHint || "",
    lastUsedAt: integration?.lastUsedAt?.toISOString() || null,
    whatsapp: {
      connected,
      status: connected ? "connected" : "disconnected",
      processingEnabled: config.browserEnabled === true,
      lastSeenAt: Number.isFinite(lastSeenAt) ? new Date(lastSeenAt).toISOString() : null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Hibás kérés." }, { status: 400 }); }
  if (!body || typeof body !== "object" || (body as { action?: unknown }).action !== "rotate_secret") {
    return NextResponse.json({ error: "Ismeretlen művelet." }, { status: 400 });
  }

  const secret = createAiStudioSecret();
  const integration = await prisma.aiStudioIntegration.upsert({
    where: { id: integrationId },
    update: { secretHash: hashAiStudioSecret(secret), secretHint: aiStudioSecretHint(secret), enabled: true },
    create: { id: integrationId, secretHash: hashAiStudioSecret(secret), secretHint: aiStudioSecretHint(secret), enabled: true },
  });

  return NextResponse.json({
    enabled: integration.enabled,
    hasSecret: true,
    secretHint: integration.secretHint,
    secret,
    backendUrl: request.nextUrl.origin,
    healthUrl: new URL("/api/integrations/ai-studio/health", request.nextUrl.origin).toString(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request, "channels:update");
  if (!isAuthenticated(auth)) return auth;

  await prisma.aiStudioIntegration.upsert({
    where: { id: integrationId },
    update: { secretHash: "", secretHint: "", enabled: false },
    create: { id: integrationId, secretHash: "", secretHint: "", enabled: false },
  });
  return NextResponse.json({ enabled: false, hasSecret: false }, { headers: { "Cache-Control": "no-store" } });
}

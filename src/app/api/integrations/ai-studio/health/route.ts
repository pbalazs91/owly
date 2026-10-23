import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAiStudioRequest } from "@/lib/integrations/ai-studio";

export async function GET(request: NextRequest) {
  if (!await authenticateAiStudioRequest(request)) {
    return NextResponse.json({ error: "Érvénytelen vagy visszavont Owly-kulcs." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const [channel, settings] = await Promise.all([
    prisma.channel.findUnique({ where: { type: "whatsapp" }, select: { isActive: true, status: true, config: true } }),
    prisma.settings.findUnique({ where: { id: "default" }, select: { aiProvider: true, aiApiKey: true } }),
  ]);
  const config = (channel?.config || {}) as Record<string, unknown>;
  const lastSeenAt = typeof config.browserLastSeen === "string" ? Date.parse(config.browserLastSeen) : NaN;
  const connected = channel?.status === "connected" && config.browserStatus === "connected" && Number.isFinite(lastSeenAt) && Date.now() - lastSeenAt <= 90000;
  const aiProvider = settings?.aiProvider || "ollama";

  return NextResponse.json({
    ok: true,
    service: "owly",
    integration: "google-ai-studio",
    checkedAt: new Date().toISOString(),
    whatsapp: {
      connected,
      status: connected ? "connected" : "disconnected",
      processingEnabled: config.browserEnabled === true,
      lastSeenAt: Number.isFinite(lastSeenAt) ? new Date(lastSeenAt).toISOString() : null,
    },
    ai: {
      provider: aiProvider,
      configured: aiProvider === "ollama" || !!settings?.aiApiKey,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

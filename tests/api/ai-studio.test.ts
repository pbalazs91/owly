import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { DELETE, GET as getSettings, PUT } from "@/app/api/integrations/ai-studio/route";
import { GET as getHealth } from "@/app/api/integrations/ai-studio/health/route";
import { hashAiStudioSecret } from "@/lib/integrations/ai-studio";
import { createRequest } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const secret = "owly_as_test-strong-shared-secret";
const stored = { id: "default", secretHash: hashAiStudioSecret(secret), secretHint: "cret", enabled: true, lastUsedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ userId: "admin", role: "admin", username: "admin", name: "Admin", authMethod: "cookie" });
  db.aiStudioIntegration.findUnique.mockResolvedValue(null);
  db.aiStudioIntegration.upsert.mockImplementation(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({ id: "default", ...args.create, ...args.update }));
  db.aiStudioIntegration.update.mockResolvedValue(stored);
  db.channel.findUnique.mockResolvedValue({ isActive: false, status: "disconnected", config: {} });
  db.settings.findUnique.mockResolvedValue({ aiProvider: "gemini", aiApiKey: "configured" });
});

describe("Google AI Studio integration", () => {
  it("returns copyable endpoints without exposing the stored credential", async () => {
    db.aiStudioIntegration.findUnique.mockResolvedValue(stored);
    const result = await getSettings(createRequest("/api/integrations/ai-studio"));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({
      backendUrl: "http://localhost:3000",
      healthUrl: "http://localhost:3000/api/integrations/ai-studio/health",
      enabled: true,
      hasSecret: true,
      secretHint: "cret",
    });
    expect(body).not.toHaveProperty("secretHash");
  });

  it("issues a high-entropy credential once and stores only its hash", async () => {
    const result = await PUT(createRequest("/api/integrations/ai-studio", { method: "PUT", body: { action: "rotate_secret" } }));
    const body = await result.json();
    expect(result.status).toBe(200);
    expect(body.secret).toMatch(/^owly_as_[A-Za-z0-9_-]{43}$/);
    expect(db.aiStudioIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ secretHash: hashAiStudioSecret(body.secret), enabled: true }),
    }));
  });

  it("authenticates health checks and reports live WhatsApp state without returning secrets", async () => {
    db.aiStudioIntegration.findUnique.mockResolvedValue(stored);
    db.channel.findUnique.mockResolvedValue({
      isActive: true,
      status: "connected",
      config: { browserStatus: "connected", browserEnabled: true, browserLastSeen: new Date().toISOString() },
    });
    const result = await getHealth(createRequest("/api/integrations/ai-studio/health", { headers: { Authorization: `Bearer ${secret}` } }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      ok: true,
      service: "owly",
      whatsapp: { connected: true, processingEnabled: true },
      ai: { provider: "gemini", configured: true },
    });
  });

  it("rejects a missing or invalid shared secret", async () => {
    const result = await getHealth(createRequest("/api/integrations/ai-studio/health", { headers: { Authorization: "Bearer wrong" } }));
    expect(result.status).toBe(401);
    expect(db.channel.findUnique).not.toHaveBeenCalled();
  });

  it("revokes the credential", async () => {
    const result = await DELETE(createRequest("/api/integrations/ai-studio", { method: "DELETE" }));
    expect(result.status).toBe(200);
    expect(db.aiStudioIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { secretHash: "", secretHint: "", enabled: false },
    }));
  });
});

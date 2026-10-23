import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/integrations/whatsapp/[provider]/inbound/route";
import { GET as channels } from "@/app/api/channels/route";
import { GET as providers, PUT } from "@/app/api/integrations/whatsapp/providers/route";
vi.mock("@/lib/customer-resolver", () => ({ resolveCustomer: vi.fn().mockResolvedValue("customer-1") }));
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const payload = { event_type: "message.received", event_id: "event-1", contact: { phone: "+36301234567", firstName: "Test" }, channel: { id: 42 }, message: { messageId: 123, channelId: 42, traffic: "incoming", timestamp: 1726740558441, message: { type: "text", text: "Hello" } } };
const settings = { enabled: true, apiKey: "private-token", signingKey: "private-signing-key", channelId: "42" };
const context = { params: Promise.resolve({ provider: "respondio" }) };
function request(signature?: string) {
  return new NextRequest("https://owly.test/api/integrations/whatsapp/respondio/inbound", { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature ?? createHmac("sha256", settings.signingKey).update(JSON.stringify(payload)).digest("base64") }, body: JSON.stringify(payload) });
}
describe("respond.io inbox integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore auth mocks after reset.
    db.channel.findUnique.mockResolvedValue({ config: { providerSettings: { respondio: settings } } });
    db.whatsAppFallback.findMany.mockResolvedValue([]);
  });
  it("rejects unsigned webhook requests before creating any records", async () => {
    expect((await POST(request("invalid"), context)).status).toBe(401);
    expect(db.whatsAppProviderEvent.create).not.toHaveBeenCalled();
  });
  it("does not import when disabled", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { providerSettings: { respondio: { ...settings, enabled: false } } } });
    expect((await POST(request(), context)).status).toBe(503);
    expect(db.message.upsert).not.toHaveBeenCalled();
  });
  it("imports a verified reply and ignores a duplicate event", async () => {
    db.whatsAppProviderEvent.create.mockResolvedValueOnce({ id: "log-1" }).mockRejectedValueOnce({ code: "P2002" });
    db.whatsAppProviderEvent.findUnique.mockResolvedValue({ status: "processed" });
    db.conversation.findFirst.mockResolvedValue({ id: "conversation-1", metadata: {} });
    db.message.upsert.mockResolvedValue({ id: "message-1", content: "Hello" });
    expect(await (await POST(request(), context)).json()).toMatchObject({ imported: 1 });
    expect(await (await POST(request(), context)).json()).toMatchObject({ imported: 0 });
    expect(db.message.upsert).toHaveBeenCalledTimes(1);
    expect(db.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: { whatsappProvider: "respondio" } }) }));
  });
});

// GET/PUT auth is tested independently with explicit mock state.
import { isAuthenticated, requireAuth } from "@/lib/route-auth";
describe("respond.io credential redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(requireAuth).mockResolvedValue({ userId: "admin", role: "admin", username: "admin", name: "Admin", authMethod: "cookie" });
    db.whatsAppFallback.findMany.mockResolvedValue([]);
  });
  it.each(["api", "browser"])("never returns credentials on disconnected %s channels", async mode => {
    db.channel.findMany.mockResolvedValue([{ type: "whatsapp", config: { mode, providerSettings: { respondio: settings } } }]);
    const body = JSON.stringify(await (await channels(new NextRequest("https://owly.test/api/channels"))).json());
    expect(body).not.toContain(settings.apiKey);
    expect(body).not.toContain(settings.signingKey);
    expect(body).toContain('"hasApiKey":true');
  });
  it("returns only credential presence in provider settings", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { providerSettings: { respondio: settings } } });
    const body = JSON.stringify(await (await providers(new NextRequest("https://owly.test/api/integrations/whatsapp/providers"))).json());
    expect(body).not.toContain(settings.apiKey);
    expect(body).not.toContain(settings.signingKey);
    expect(body).toContain('"hasSigningKey":true');
  });
  it("uses the public Render URL behind a reverse proxy", async () => {
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://owlyapp.onrender.com");
    db.channel.findUnique.mockResolvedValue({ config: {} });
    const body = await (await providers(new NextRequest("http://0.0.0.0:10000/api/integrations/whatsapp/providers"))).json();
    expect(body.webhooks.respondio).toBe("https://owlyapp.onrender.com/api/integrations/whatsapp/respondio/inbound");
    vi.unstubAllEnvs();
  });
  it("preserves saved credentials when fields are left empty", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { providerSettings: { respondio: settings } } });
    const response = await PUT(new NextRequest("https://owly.test/api/integrations/whatsapp/providers", { method: "PUT", body: JSON.stringify({ fallbackEnabled: false, fallbackProvider: "respondio", infobip: { baseUrl: "", sender: "" }, peach: { flowId: "" }, respondio: { enabled: true, channelId: "42", apiKey: "", signingKey: "" } }) }));
    expect(response.status).toBe(200);
    expect(db.channel.upsert.mock.calls[0][0].update.config.providerSettings.respondio).toEqual(settings);
  });
});

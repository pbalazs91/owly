import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { createRequest, parseJsonResponse } from "../helpers/request";
import { POST, GET } from "@/app/api/channels/whatsapp/browser/route";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const audience = "owly-whatsapp-browser";
const key = () => createHmac("sha256", process.env.JWT_SECRET!).update(audience).digest("hex");
const token = (jti = "test-pair") => jwt.sign({ userId: "admin1", jti, scope: "whatsapp-browser" }, key(), { audience, expiresIn: "1h" });
const request = (body: Record<string, unknown>, value = token()) => createRequest("/api/channels/whatsapp/browser", { method: "POST", body, headers: { "x-api-key": value } });

beforeEach(() => {
  vi.clearAllMocks();
  db.channel.findUnique.mockResolvedValue({ config: { browserTokenId: "test-pair" } });
  db.channel.upsert.mockResolvedValue({}); db.channel.update.mockResolvedValue({});
  db.admin.findUnique.mockResolvedValue({ role: "admin" });
  db.conversation.upsert.mockResolvedValue({ id: "conv1", status: "active" });
  db.message.findUnique.mockResolvedValue(null);
  db.message.create.mockResolvedValue({}); db.message.upsert.mockResolvedValue({});
  db.settings.findUnique.mockResolvedValue({ aiProvider: "ollama", aiApiKey: "never-return-this", maxTokens: 2048, businessName: "Test" });
  db.knowledgeEntry.findMany.mockResolvedValue([]);
  db.message.findMany.mockResolvedValue([{ role: "customer", content: "Szia" }]);
});

describe("Restricted WhatsApp browser connection", () => {
  it("prevents the legacy AI pipeline while reply-only RocketSender mode is active", async () => {
    db.rocketIntegration.findUnique.mockResolvedValueOnce({ mode: "trial" });
    expect((await POST(request({ action: "incoming", chatId: "123@c.us", id: "test", content: "Szia" }))).status).toBe(409);
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.settings.findUnique).not.toHaveBeenCalled();
  });
  it("imports historical text with original times and roles without starting AI", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { browserTokenId: "test-pair", browserHistory: { id: "job", status: "pending" } } });
    db.message.findFirst.mockResolvedValue(null);
    const response = await POST(request({ action: "history", requestId: "job", chatId: "123@c.us", name: "Test", messages: [
      { id: "old-in", content: "Earlier question", fromMe: false, timestamp: 1700000000000 },
      { id: "old-out", content: "Earlier answer", fromMe: true, timestamp: 1700000001000 },
    ] }));
    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toMatchObject({ imported: 2 });
    expect(db.message.upsert.mock.calls[0][0].create).toMatchObject({ role: "customer", createdAt: new Date(1700000000000) });
    expect(db.message.upsert.mock.calls[1][0].create.role).toBe("assistant");
    expect(db.settings.findUnique).not.toHaveBeenCalled();
    expect(db.knowledgeEntry.findMany).not.toHaveBeenCalled();
  });
  it("skips an already imported message and rejects an unrequested history import", async () => {
    const body = { action: "history", requestId: "job", chatId: "123@c.us", name: "Test", messages: [{ id: "old", content: "Text", fromMe: false, timestamp: 1700000000000 }] };
    expect((await POST(request(body))).status).toBe(409);
    db.channel.findUnique.mockResolvedValue({ config: { browserTokenId: "test-pair", browserHistory: { id: "job", status: "pending" } } });
    db.message.findUnique.mockResolvedValue({ id: "existing" });
    expect(await parseJsonResponse(await POST(request(body)))).toMatchObject({ imported: 0 });
    expect(db.message.upsert).not.toHaveBeenCalled();
  });
  it("stores explicitly approved phone numbers in private channel settings", async () => {
    const response = await POST(createRequest("/api/channels/whatsapp/browser", { method: "POST", body: { action: "allowPhone", phone: "+1 202 555 0123" } }));
    expect(response.status).toBe(200);
    expect(db.channel.update.mock.calls[0][0].data.config.browserAlwaysAllowed).toEqual({ '12025550123@c.us': '+12025550123' });
  });
  it("reports WhatsApp connectivity separately from paused processing", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { browserTokenId: "test-pair", browserStatus: "connected", browserLastSeen: new Date().toISOString(), browserEnabled: false, browserProtocol: 2 } });
    const data = await parseJsonResponse(await GET(createRequest("/api/channels/whatsapp/browser")));
    expect(data.status).toBe("connected"); expect(data.enabled).toBe(false); expect(data.supportsControl).toBe(true);
  });
  it("keeps a remote toggle pending until the extension acknowledges it", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { browserTokenId: "test-pair", browserControlRevision: "revision1", browserDesiredEnabled: true } });
    const response = await POST(request({ action: "heartbeat", status: "connected", enabled: false, protocol: 2, controlRevision: "" }));
    expect(await parseJsonResponse(response)).toMatchObject({ desiredEnabled: true, controlRevision: "revision1" });
    const data = db.channel.update.mock.calls[0][0].data;
    expect(data.isActive).toBe(false); expect(data.config.browserDesiredEnabled).toBe(true);
  });
  it("blocks incoming processing immediately when paused in Owly", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { browserTokenId: "test-pair", browserDesiredEnabled: false } });
    expect((await POST(request({ action: "incoming", chatId: "123@c.us", id: "test", content: "Szia" }))).status).toBe(409);
    expect(db.message.create).not.toHaveBeenCalled();
  });
  it("issues a restricted token that cannot become an Owly login token", async () => {
    const response = await POST(request({ action: "pair" }));
    const data = await parseJsonResponse(response);
    expect(response.status).toBe(200);
    expect((jwt.verify(data.token, key(), { audience }) as jwt.JwtPayload).scope).toBe("whatsapp-browser");
    expect(verifyToken(data.token)).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects ordinary admin tokens on the restricted endpoint", async () => {
    const ordinary = jwt.sign({ userId: "admin1", role: "admin" }, process.env.JWT_SECRET!);
    expect((await POST(request({ action: "heartbeat", status: "connected" }, ordinary))).status).toBe(401);
  });
  it("rejects a revoked token", async () => {
    expect((await POST(request({ action: "heartbeat", status: "connected" }, token("old-pair")))).status).toBe(401);
    expect(db.channel.update).not.toHaveBeenCalled();
  });
  it("rejects access after the owner is removed", async () => {
    db.admin.findUnique.mockResolvedValue(null);
    expect((await POST(request({ action: "heartbeat", status: "connected" }))).status).toBe(403);
  });
  it("marks an inactive browser offline without disclosing the pairing id", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { browserTokenId: "test-pair", browserLastSeen: new Date(Date.now() - 100000).toISOString(), browserStatus: "connected" } });
    const data = await parseJsonResponse(await GET(createRequest("/api/channels/whatsapp/browser")));
    expect(data.online).toBe(false); expect(data.status).toBe("disconnected");
    expect(JSON.stringify(data)).not.toContain("test-pair");
  });
  it("records a valid heartbeat but rejects arbitrary status values", async () => {
    expect((await POST(request({ action: "heartbeat", status: "connected" }))).status).toBe(200);
    expect(db.channel.update.mock.calls.at(-1)?.[0].data.isActive).toBe(true);
    expect((await POST(request({ action: "heartbeat", status: "invented" }))).status).toBe(400);
  });
  it("rejects group chats before storing messages", async () => {
    expect((await POST(request({ action: "incoming", chatId: "123@g.us", id: "x", content: "hi" }))).status).toBe(400);
    expect(db.message.create).not.toHaveBeenCalled();
  });
  it("stores new text and supplies bounded local AI context without API secrets", async () => {
    const response = await POST(request({ action: "incoming", chatId: "123@c.us", id: "one", content: "Szia", name: "Ügyfél" }));
    const data = await parseJsonResponse(response);
    expect(response.status).toBe(200); expect(data.aiEnabled).toBe(true);
    expect(data.maxTokens).toBe(512); expect(data.messages.at(-1)).toEqual({ role: "user", content: "Szia" });
    expect(JSON.stringify(data)).not.toContain("never-return-this");
    expect(db.message.create).toHaveBeenCalledOnce();
  });
  it("does not generate another reply after an acknowledged delivery", async () => {
    db.message.findUnique.mockResolvedValue({ id: "existing" });
    const data = await parseJsonResponse(await POST(request({ action: "incoming", chatId: "123@c.us", id: "one", content: "Szia" })));
    expect(data.duplicate).toBe(true); expect(db.message.create).not.toHaveBeenCalled();
  });
  it("allows retrying model failure without inserting the customer message twice", async () => {
    db.message.findUnique.mockResolvedValueOnce({ id: "existing" }).mockResolvedValueOnce(null);
    const data = await parseJsonResponse(await POST(request({ action: "incoming", chatId: "123@c.us", id: "one", content: "Szia" })));
    expect(data.aiEnabled).toBe(true); expect(db.message.create).not.toHaveBeenCalled();
  });
  it("stops local AI when a conversation has been escalated", async () => {
    db.conversation.upsert.mockResolvedValue({ id: "conv1", status: "escalated" });
    const data = await parseJsonResponse(await POST(request({ action: "incoming", chatId: "123@c.us", id: "one", content: "Szia" })));
    expect(data.aiEnabled).toBe(false);
  });
});

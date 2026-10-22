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

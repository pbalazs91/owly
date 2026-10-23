import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest } from "../helpers/request";
import { POST as inbound } from "@/app/api/integrations/rocketsender/inbound/route";
import { POST as configure } from "@/app/api/integrations/rocketsender/route";
import { POST as outbound } from "@/app/api/integrations/rocketsender/outbound/route";
import { drainRocketQueue } from "@/lib/rocketsender/importer";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const accountId = "+12025550100", phone = "+12025550123";
const reply = { eventType: "reply", eventId: "event1", externalMessageId: "message1", conversationId: "chat1", accountId, phone, name: "Test", content: "Reply", occurredAt: "2026-10-20T12:05:00Z" };
const req = (body: unknown) => createRequest("/api/integrations/rocketsender", { method: "POST", body });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ userId: "admin", role: "admin", username: "admin", name: "Admin", authMethod: "cookie" });
  db.rocketIntegration.findUnique.mockResolvedValue({ mode: "trial", accountId, trialPhone: phone, compatibilityVerified: false });
  db.rocketOutbound.findFirst.mockResolvedValue({ id: "sent1" });
  db.rocketOutbound.findUnique.mockResolvedValue(null);
  db.rocketOutbound.upsert.mockImplementation(async (args: any) => args.create);
  db.rocketImportEvent.upsert.mockImplementation(async (args: any) => ({ ...args.create, status: "pending" }));
  db.rocketImportEvent.findMany.mockResolvedValue([]);
  db.rocketImportEvent.findFirst.mockResolvedValue(null);
  db.channel.findUnique.mockResolvedValue({ config: { browserEnabled: true } });
  db.$transaction.mockReset();
});

describe("Reply-gated RocketSender imports", () => {
  it("authenticates before accepting even a delivery receipt", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await inbound(req({ eventType: "delivered" }))).status).toBe(401);
    expect(db.rocketImportEvent.upsert).not.toHaveBeenCalled();
  });
  it.each(["delivered", "read", "outbound"])("ignores %s without creating a profile or event", async eventType => {
    expect((await (await inbound(req({ eventType }))).json()).ignored).toBe(true);
    expect(db.rocketImportEvent.upsert).not.toHaveBeenCalled();
    expect(db.customer.create).not.toHaveBeenCalled();
  });
  it("ignores unknown senders without storing their message bodies", async () => {
    db.rocketOutbound.findFirst.mockResolvedValue(null);
    expect((await (await inbound(req(reply))).json()).ignored).toBe(true);
    expect(db.rocketImportEvent.upsert).not.toHaveBeenCalled();
  });
  it("persists a qualifying reply before queue processing, preserving source time and IDs", async () => {
    expect((await inbound(req(reply))).status).toBe(202);
    expect(db.rocketImportEvent.upsert.mock.calls[0][0].create.payload).toMatchObject(reply);
    expect(db.rocketOutbound.findFirst.mock.calls[0][0].where.sentAt.lte).toEqual(new Date(reply.occurredAt));
    expect(db.customer.create).not.toHaveBeenCalled();
  });
  it("does not import a different WhatsApp account or a disabled integration", async () => {
    expect((await (await inbound(req({ ...reply, accountId: "+12025550199" }))).json()).ignored).toBe(true);
    db.rocketIntegration.findUnique.mockResolvedValue({ mode: "disabled", accountId });
    expect((await (await inbound(req(reply))).json()).ignored).toBe(true);
    expect(db.rocketImportEvent.upsert).not.toHaveBeenCalled();
  });
  it("registers actual sends without creating Owly customers", async () => {
    const response = await outbound(req([{ status: "sent", accountId, phone, campaignId: "campaign1", sentAt: "2026-10-20T12:00:00Z" }]));
    expect(response.status).toBe(200);
    expect((await response.json()).customersCreated).toBe(0);
    expect(db.customer.create).not.toHaveBeenCalled();
    expect(db.conversation.create).not.toHaveBeenCalled();
  });
  it("rejects planned sends and refuses production activation before the real trial", async () => {
    expect((await outbound(req([{ status: "planned", accountId, phone, campaignId: "campaign1", sentAt: "2026-10-20T12:00:00Z" }]))).status).toBe(400);
    expect((await configure(req({ action: "configure", mode: "active", accountId, trialPhone: phone, compatibilityVerified: true }))).status).toBe(409);
    expect(db.rocketIntegration.upsert).not.toHaveBeenCalled();
  });
  it("does not certify compatibility without an imported test reply", async () => {
    expect((await configure(req({ action: "verify", confirmed: true }))).status).toBe(409);
    expect(db.rocketIntegration.update).not.toHaveBeenCalled();
  });
  it("keeps failures in a dead queue after five attempts", async () => {
    db.rocketImportEvent.findMany.mockResolvedValue([{ id: "event", status: "pending", attempts: 4, lockedAt: null }]);
    db.rocketImportEvent.updateMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockRejectedValue(new Error("Temporary database failure"));
    await drainRocketQueue();
    expect(db.rocketImportEvent.update.mock.calls[0][0].data).toMatchObject({ status: "dead", attempts: 5, lockedAt: null, lastErrorCode: "DATABASE_OR_PROCESSING_ERROR" });
  });
  it("pauses durable queue processing with the main WhatsApp switch", async () => {
    db.channel.findUnique.mockResolvedValue({ config: { browserDesiredEnabled: false } });
    await drainRocketQueue();
    expect(db.rocketImportEvent.findMany).not.toHaveBeenCalled();
  });
});

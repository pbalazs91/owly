import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { processDueWhatsAppFallbacks, scheduleWhatsAppFallback } from "@/lib/channels/whatsapp-fallback";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("WhatsApp reply fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules a durable fallback 15 minutes after an incoming message", async () => {
    db.channel.findUnique.mockResolvedValue({
      config: { fallbackEnabled: true, fallbackProvider: "infobip" },
    });
    db.whatsAppFallback.upsert.mockResolvedValue({});

    const before = Date.now();
    await scheduleWhatsAppFallback({
      inboundMessageId: "wab-" + "a".repeat(64),
      conversationId: "conversation-1",
      customerContact: "+36301234567",
    });
    const input = db.whatsAppFallback.upsert.mock.calls[0][0];

    expect(input.create.fallbackProvider).toBe("infobip");
    expect(input.create.dueAt.getTime()).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(input.create.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });

  it("does not send when there is no prepared Owly response", async () => {
    db.whatsAppFallback.findMany.mockResolvedValue([]);
    await expect(processDueWhatsAppFallbacks(new Date("2026-10-23T12:00:00Z")))
      .resolves.toBe(0);
    expect(db.whatsAppFallback.updateMany).not.toHaveBeenCalled();
  });

  it("sends the prepared message only once and records the provider message ID", async () => {
    const item = {
      id: "fallback-1",
      inboundMessageId: "wab-" + "b".repeat(64),
      conversationId: "conversation-1",
      customerContact: "+36301234567",
      replyContent: "Prepared reply",
      fallbackProvider: "infobip",
      createdAt: new Date("2026-10-23T11:00:00Z"),
    };
    db.whatsAppFallback.findMany.mockResolvedValue([item]);
    db.whatsAppFallback.updateMany.mockResolvedValue({ count: 1 });
    db.message.findFirst.mockResolvedValue(null);
    db.channel.findUnique.mockResolvedValue({
      config: { providerSettings: { infobip: { baseUrl: "abc.api.infobip.com", apiKey: "key", sender: "123456" } } },
    });
    db.whatsAppFallback.update.mockResolvedValue({});
    db.message.upsert.mockResolvedValue({ id: "fallback-message", content: "Prepared reply" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ messageId: "provider-1" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(processDueWhatsAppFallbacks(new Date("2026-10-23T12:00:00Z")))
      .resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.whatsAppFallback.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "fallback-1" },
      data: expect.objectContaining({ status: "fallback_sent", providerMessageId: "provider-1" }),
    }));
  });

  it("does not fail over again when provider acceptance is uncertain", async () => {
    const item = {
      id: "fallback-2",
      inboundMessageId: "wab-" + "c".repeat(64),
      conversationId: "conversation-1",
      customerContact: "+36301234567",
      replyContent: "Prepared reply",
      fallbackProvider: "infobip",
      createdAt: new Date("2026-10-23T11:00:00Z"),
    };
    db.whatsAppFallback.findMany.mockResolvedValue([item]);
    db.whatsAppFallback.updateMany.mockResolvedValue({ count: 1 });
    db.message.findFirst.mockResolvedValue(null);
    db.channel.findUnique.mockResolvedValue({
      config: { providerSettings: { infobip: { baseUrl: "abc.api.infobip.com", apiKey: "key", sender: "123456" } } },
    });
    db.whatsAppFallback.update.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    await processDueWhatsAppFallbacks(new Date("2026-10-23T12:00:00Z"));
    expect(db.whatsAppFallback.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "fallback-2" },
      data: expect.objectContaining({ status: "uncertain" }),
    }));
    expect(db.message.upsert).not.toHaveBeenCalled();
  });
});

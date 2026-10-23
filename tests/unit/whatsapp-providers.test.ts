import { describe, expect, it, vi } from "vitest";
import {
  normalizeE164,
  parseInfobipInbound,
  parsePeachReply,
  sendInfobipText,
  sendPeachAppMessage,
} from "@/lib/channels/whatsapp-providers";

describe("WhatsApp provider adapters", () => {
  it("normalizes international phone numbers and rejects local-only values", () => {
    expect(normalizeE164("+36 (30) 123-4567")).toBe("+36301234567");
    expect(() => normalizeE164("06301234567")).toThrow();
  });

  it("parses only inbound Infobip text messages", () => {
    const events = parseInfobipInbound({
      results: [
        { from: "36301234567", messageId: "in-1", message: { text: "  Hello  " }, sentAt: "2026-10-23T10:00:00Z" },
        { from: "36309999999", messageId: "status-1", message: { text: "" } },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventId: "in-1", phone: "+36301234567", text: "Hello" });
  });

  it("parses Peach reply webhook events and ignores non-reply events", () => {
    const payload = {
      type: "message_delivery.replied",
      data: {
        message: { id: "template-1", created_at: "2026-10-23T10:00:00Z", reply: {
          id: 44, text: "Rendben", author: { phone_number: "+36301234567", name: "Péter" },
        } },
      },
    };
    expect(parsePeachReply(payload)[0]).toMatchObject({
      eventId: "peach:44", phone: "+36301234567", name: "Péter", text: "Rendben",
    });
    expect(parsePeachReply({ type: "message_delivery.read", data: {} })).toEqual([]);
  });

  it("marks accepted Infobip requests with provider IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ messageId: "out-1" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const result = await sendInfobipText(
      { baseUrl: "https://abc.api.infobip.com", apiKey: "secret", sender: "123456" },
      "+36301234567",
      "Hello",
      fetchMock,
    );
    expect(result).toEqual({ outcome: "accepted", providerMessageId: "out-1" });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "App secret" });
  });

  it("never treats an ambiguous provider timeout as a safe fallback signal", async () => {
    const networkFailure = vi.fn().mockRejectedValue(new Error("timeout"));
    const serverFailure = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const definiteRejection = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    const config = { baseUrl: "abc.api.infobip.com", apiKey: "secret", sender: "123456" };

    await expect(sendInfobipText(config, "+36301234567", "Hello", networkFailure))
      .resolves.toEqual({ outcome: "uncertain", code: "network_result_unknown" });
    await expect(sendInfobipText(config, "+36301234567", "Hello", serverFailure))
      .resolves.toEqual({ outcome: "uncertain", code: "http_503" });
    await expect(sendInfobipText(config, "+36301234567", "Hello", definiteRejection))
      .resolves.toEqual({ outcome: "rejected", code: "http_400" });
  });

  it("sends Peach through a configured App flow", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ event_id: "peach-event-1" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    const result = await sendPeachAppMessage(
      { apiKey: "secret", flowId: "flow-1" }, "+36301234567", "Hello", fetchMock,
    );
    expect(result).toEqual({ outcome: "accepted", providerMessageId: "peach-event-1" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      event_type: "send_app_message",
      contact: { phone_number: "+36301234567" },
      flow: { id: "flow-1", liquid_values: { message: "Hello" } },
    });
  });
});

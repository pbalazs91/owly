import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseRespondioInbound, sendRespondioText, verifyRespondioSignature } from "@/lib/channels/respondio";

export const incoming = {
  event_type: "message.received", event_id: "evt-1",
  contact: { phone: "+36301234567", firstName: "Test", lastName: "Contact" },
  channel: { id: 42, source: "whatsapp" },
  message: { messageId: 1726740558441000, channelId: 42, traffic: "incoming", timestamp: 1726740558441, message: { type: "text", text: "Hello" } },
};

describe("respond.io", () => {
  it("uses the documented endpoint and explicit channel with bearer authentication", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ messageId: 123456 }));
    expect(await sendRespondioText({ apiKey: "test-token", channelId: "42" }, "+36 30 1234567", " Hello ", fetcher))
      .toEqual({ outcome: "accepted", providerMessageId: "123456" });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.respond.io/v2/contact/phone%3A%2B36301234567/message");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ channelId: 42, message: { type: "text", text: "Hello" } });
  });
  it.each([408, 449, 500, 503])("treats HTTP %i as uncertain to prevent a second send", async status => {
    expect(await sendRespondioText({ apiKey: "test", channelId: "42" }, "+36301234567", "Hello", vi.fn().mockResolvedValue(new Response("", { status }))))
      .toMatchObject({ outcome: "uncertain" });
  });
  it("does not retry after a network failure or missing acknowledgement", async () => {
    const config = { apiKey: "test", channelId: "42" };
    expect(await sendRespondioText(config, "+36301234567", "Hello", vi.fn().mockRejectedValue(new Error("timeout")))).toMatchObject({ outcome: "uncertain" });
    expect(await sendRespondioText(config, "+36301234567", "Hello", vi.fn().mockResolvedValue(Response.json({})))).toMatchObject({ outcome: "uncertain" });
    expect(await sendRespondioText(config, "+36301234567", "Hello", vi.fn().mockResolvedValue(new Response("", { status: 400 })))).toMatchObject({ outcome: "rejected" });
  });
  it("validates configuration and contact before any request", async () => {
    const fetcher = vi.fn();
    expect(await sendRespondioText({ apiKey: "", channelId: "42" }, "+36301234567", "Hello", fetcher)).toMatchObject({ outcome: "rejected" });
    expect(await sendRespondioText({ apiKey: "test", channelId: "42" }, "06301234567", "Hello", fetcher)).toMatchObject({ outcome: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("verifies the documented base64 HMAC and rejects tampering", () => {
    const signature = createHmac("sha256", "test-key").update(JSON.stringify(incoming)).digest("base64");
    expect(verifyRespondioSignature(incoming, signature, "test-key")).toBe(true);
    expect(verifyRespondioSignature({ ...incoming, event_id: "changed" }, signature, "test-key")).toBe(false);
    expect(verifyRespondioSignature(incoming, "invalid", "test-key")).toBe(false);
    expect(verifyRespondioSignature(incoming, signature, "")).toBe(false);
  });
  it("retains original IDs and timestamps and only accepts the configured channel", () => {
    expect(parseRespondioInbound(incoming, "42")[0]).toMatchObject({ provider: "respondio", eventId: "evt-1", messageId: "42:1726740558441000", phone: "+36301234567", name: "Test Contact", text: "Hello", sentAt: new Date(1726740558441) });
    expect(parseRespondioInbound(incoming, "43")).toEqual([]);
    expect(parseRespondioInbound({ ...incoming, event_type: "message.sent" }, "42")).toEqual([]);
    expect(parseRespondioInbound({ ...incoming, message: { ...incoming.message, traffic: "outgoing" } }, "42")).toEqual([]);
    expect(parseRespondioInbound({ ...incoming, message: { ...incoming.message, message: { type: "image" } } }, "42")).toEqual([]);
  });
});

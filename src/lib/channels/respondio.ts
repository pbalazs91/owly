import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeE164, type NormalizedInboundWhatsApp, type ProviderSendResult } from "./whatsapp-providers";

export interface RespondioConfig { apiKey: string; channelId: string }

/** Fixed API host; never forward credentials to a user-supplied endpoint. */
export async function sendRespondioText(config: RespondioConfig, to: string, text: string, fetchImpl: typeof fetch = fetch): Promise<ProviderSendResult> {
  if (!config.apiKey.trim() || !/^[1-9]\d*$/.test(config.channelId) || !Number.isSafeInteger(Number(config.channelId))) {
    return { outcome: "rejected", code: "provider_not_configured" };
  }
  if (!text.trim() || text.length > 4096) return { outcome: "rejected", code: "invalid_message_length" };
  let phone: string;
  try { phone = normalizeE164(to); } catch { return { outcome: "rejected", code: "invalid_phone" }; }
  let response: Response;
  try {
    response = await fetchImpl(`https://api.respond.io/v2/contact/${encodeURIComponent("phone:" + phone)}/message`, {
      method: "POST",
      headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ channelId: Number(config.channelId), message: { type: "text", text: text.trim() } }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch { return { outcome: "uncertain", code: "network_result_unknown" }; }
  if (!response.ok) return { outcome: response.status >= 500 || response.status === 449 || response.status === 408 ? "uncertain" : "rejected", code: "http_" + response.status };
  try {
    const body = await response.json() as { messageId?: unknown };
    const id = body.messageId;
    return (typeof id === "string" && !!id) || (typeof id === "number" && Number.isSafeInteger(id) && id > 0)
      ? { outcome: "accepted", providerMessageId: String(id) }
      : { outcome: "uncertain", code: "accepted_without_message_id" };
  } catch { return { outcome: "uncertain", code: "invalid_provider_response" }; }
}

/** respond.io signs JSON.stringify(body) with HMAC-SHA256, base64 encoded. */
export function verifyRespondioSignature(payload: unknown, signature: string, signingKey: string): boolean {
  if (!signingKey || !signature) return false;
  const expected = createHmac("sha256", signingKey).update(JSON.stringify(payload)).digest("base64");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function parseRespondioInbound(payload: unknown, channelId: string): NormalizedInboundWhatsApp[] {
  const root = record(payload), contact = record(root.contact), message = record(root.message), channel = record(root.channel);
  const content = record(message.message);
  // Explicit channel matching avoids importing Facebook/email or another WA account.
  if (root.event_type !== "message.received" || message.traffic !== "incoming" || content.type !== "text" || !channelId || String(channel.id) !== channelId || String(message.channelId) !== channelId) return [];
  if (typeof root.event_id !== "string" || !root.event_id || typeof content.text !== "string" || !content.text.trim()) return [];
  const id = message.messageId;
  if (!(typeof id === "string" && id) && !(typeof id === "number" && Number.isSafeInteger(id) && id > 0)) return [];
  if (typeof message.timestamp !== "number" || !Number.isFinite(message.timestamp)) return [];
  const sentAt = new Date(message.timestamp);
  if (Number.isNaN(sentAt.getTime())) return [];
  let phone: string;
  try { phone = normalizeE164(typeof contact.phone === "string" ? contact.phone : ""); } catch { return []; }
  return [{ provider: "respondio", eventId: root.event_id, messageId: `${channelId}:${id}`, phone,
    name: [contact.firstName, contact.lastName].filter(value => typeof value === "string").join(" ").trim() || "Unknown",
    text: content.text.trim(), sentAt }];
}

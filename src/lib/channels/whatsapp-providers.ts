/** WhatsApp provider adapters used by the unified inbox. */

export type ProviderSendResult =
  | { outcome: "accepted"; providerMessageId: string }
  | { outcome: "rejected"; code: string }
  | { outcome: "uncertain"; code: string };

export interface InfobipWhatsAppConfig {
  baseUrl: string;
  apiKey: string;
  sender: string;
}

export interface PeachWhatsAppConfig {
  apiKey: string;
  flowId: string;
  sender?: string;
}

export function normalizeE164(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!trimmed.startsWith("+") || digits.length < 8 || digits.length > 15) {
    throw new Error("A telefonszámot nemzetközi formátumban, + előtaggal add meg.");
  }
  return "+" + digits;
}

/** Network errors and 5xx replies are uncertain: never fail over on those. */
export async function sendInfobipText(
  config: InfobipWhatsAppConfig,
  to: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderSendResult> {
  if (!config.apiKey.trim() || !config.sender.trim() || !config.baseUrl.trim()) {
    return { outcome: "rejected", code: "provider_not_configured" };
  }
  if (!text.trim()) return { outcome: "rejected", code: "empty_message" };

  let endpoint: URL;
  try {
    const host = config.baseUrl.trim().replace(/\/+$/, "");
    endpoint = new URL(host.includes("://") ? host : "https://" + host);
    if (endpoint.protocol !== "https:") return { outcome: "rejected", code: "https_required" };
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/whatsapp/1/message/text";
  } catch {
    return { outcome: "rejected", code: "invalid_base_url" };
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: "App " + config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [{ from: config.sender, to: normalizeE164(to), content: { text } }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { outcome: "uncertain", code: "network_result_unknown" };
  }

  if (!response.ok) {
    return response.status >= 500
      ? { outcome: "uncertain", code: "http_" + response.status }
      : { outcome: "rejected", code: "http_" + response.status };
  }
  try {
    const body = (await response.json()) as { messages?: Array<{ messageId?: unknown }> };
    const id = typeof body.messages?.[0]?.messageId === "string" ? body.messages[0].messageId : "";
    return id
      ? { outcome: "accepted", providerMessageId: id }
      : { outcome: "uncertain", code: "accepted_without_message_id" };
  } catch {
    return { outcome: "uncertain", code: "invalid_provider_response" };
  }
}

/** Peach sends an App flow; the configured flow must render its message value. */
export async function sendPeachAppMessage(
  config: PeachWhatsAppConfig,
  to: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderSendResult> {
  if (!config.apiKey.trim() || !config.flowId.trim()) {
    return { outcome: "rejected", code: "provider_not_configured" };
  }
  if (!text.trim()) return { outcome: "rejected", code: "empty_message" };

  let response: Response;
  try {
    response = await fetchImpl("https://app.trypeach.io/api/v1/events", {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        event_type: "send_app_message",
        contact: { phone_number: normalizeE164(to) },
        flow: { id: config.flowId, liquid_values: { message: text } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { outcome: "uncertain", code: "network_result_unknown" };
  }

  if (!response.ok) {
    return response.status >= 500
      ? { outcome: "uncertain", code: "http_" + response.status }
      : { outcome: "rejected", code: "http_" + response.status };
  }
  try {
    const body = (await response.json()) as { event_id?: unknown };
    return typeof body.event_id === "string" && body.event_id
      ? { outcome: "accepted", providerMessageId: body.event_id }
      : { outcome: "uncertain", code: "accepted_without_event_id" };
  } catch {
    return { outcome: "uncertain", code: "invalid_provider_response" };
  }
}

export interface NormalizedInboundWhatsApp {
  provider: "infobip" | "peach";
  eventId: string;
  messageId: string;
  phone: string;
  name: string;
  text: string;
  sentAt: Date;
}

/** Parse Infobip's inbound results payload; status reports are ignored. */
export function parseInfobipInbound(payload: unknown): NormalizedInboundWhatsApp[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const events: NormalizedInboundWhatsApp[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const from = typeof value.from === "string" ? value.from : "";
    const messageId = typeof value.messageId === "string" ? value.messageId : "";
    const content = value.message as Record<string, unknown> | undefined;
    const text = typeof content?.text === "string" ? content.text.trim() : "";
    if (!from || !messageId || !text || value.isForwarded === true) continue;
    let phone: string;
    try { phone = normalizeE164(from.startsWith("+") ? from : "+" + from); } catch { continue; }
    const timestamp = typeof value.sentAt === "string" ? new Date(value.sentAt) : new Date();
    events.push({
      provider: "infobip",
      eventId: messageId,
      messageId,
      phone,
      name: "Unknown",
      text,
      sentAt: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    });
  }
  return events;
}

/** Parse Peach's customer-reply delivery webhook. */
export function parsePeachReply(payload: unknown): NormalizedInboundWhatsApp[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  if (root.type !== "message_delivery.replied") return [];
  const data = root.data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;
  const reply = message?.reply as Record<string, unknown> | undefined;
  const author = reply?.author as Record<string, unknown> | undefined;
  const phoneValue = typeof author?.phone_number === "string" ? author.phone_number : "";
  const text = typeof reply?.text === "string" ? reply.text.trim() : "";
  const id = reply?.id;
  if (!phoneValue || !text || (typeof id !== "number" && typeof id !== "string")) return [];
  let phone: string;
  try { phone = normalizeE164(phoneValue); } catch { return []; }
  const name = typeof author?.name === "string" && author.name.trim() ? author.name.trim() : "Unknown";
  const createdAt = typeof message?.created_at === "string" ? new Date(message.created_at) : new Date();
  const messageId = String(id);
  return [{
    provider: "peach",
    eventId: "peach:" + messageId,
    messageId,
    phone,
    name,
    text,
    sentAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
  }];
}

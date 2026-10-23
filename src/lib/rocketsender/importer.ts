import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Owly currently has one organization per installation. Do not accept tenant
// identifiers from events, or imply that its existing customer API is multi-tenant.
export const organizationId = "default";
export const key = (...parts: string[]) => "rocket-" + createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export function ensureCustomerTag(value: string, target: string) {
  const tags = value.split(",").map(tag => tag.trim()).filter(Boolean);
  if (!tags.some(tag => tag.toLowerCase() === target.toLowerCase())) tags.push(target);
  return tags.join(", ");
}
export function normalizeRocketPhone(value: string) {
  const phone = value.replace(/@(c\.us|s\.whatsapp\.net)$/, "").replace(/[+\s().-]/g, "");
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error("INVALID_INTERNATIONAL_PHONE");
  return "+" + phone;
}
const phone = z.string().max(100).transform((value, context) => {
  try { return normalizeRocketPhone(value); }
  catch { context.addIssue({ code: "custom", message: "Nemzetközi telefonszám szükséges." }); return z.NEVER; }
});
const time = z.iso.datetime({ offset: true }).refine(value => Date.parse(value) <= Date.now() + 300000, "Jövőbeli időpont nem fogadható el.");
export const replySchema = z.object({
  eventType: z.enum(["reply", "delivered", "read", "outbound"]),
  eventId: z.string().min(1).max(250), accountId: phone, phone,
  externalMessageId: z.string().min(1).max(250),
  conversationId: z.string().min(1).max(250),
  name: z.string().trim().max(200).default(""),
  content: z.string().trim().min(1).max(6000), occurredAt: time,
});
export const outboundSchema = z.object({
  status: z.literal("sent"), accountId: phone, phone,
  campaignId: z.string().trim().min(1).max(100),
  sourceMessageId: z.string().max(250).default(""),
  content: z.string().max(6000).default(""), sentAt: time,
});
export type Reply = z.infer<typeof replySchema>;
type Database = typeof prisma | Prisma.TransactionClient;
class ImportFailure extends Error { constructor(public code: string) { super(code); } }

export async function eligibility(accountId: string, customerPhone: string, occurredAt: string, db: Database = prisma) {
  const settings = await db.rocketIntegration.findUnique({ where: { id: "default" } });
  if (!settings || settings.mode === "disabled" || settings.accountId !== accountId) return null;
  if (settings.mode === "trial" && settings.trialPhone !== customerPhone) return null;
  if (settings.mode === "active" && !settings.compatibilityVerified) return null;
  return db.rocketOutbound.findFirst({ where: { organizationId, accountId, phone: customerPhone, sentAt: { lte: new Date(occurredAt) } }, orderBy: { sentAt: "desc" } });
}

export async function registerOutbound(input: z.infer<typeof outboundSchema>) {
  const settings = await prisma.rocketIntegration.findUnique({ where: { id: "default" } });
  if (!settings || settings.accountId !== input.accountId) throw new ImportFailure("ACCOUNT_NOT_CONFIGURED");
  const sourceMessageId = input.sourceMessageId || key("registry", input.accountId, input.phone, input.campaignId, new Date(input.sentAt).toISOString());
  const id = key(organizationId, input.accountId, sourceMessageId);
  const existing = await prisma.rocketOutbound.findUnique({ where: { id } });
  if (existing && (existing.phone !== input.phone || existing.campaignId !== input.campaignId || existing.sentAt.getTime() !== Date.parse(input.sentAt))) throw new ImportFailure("OUTBOUND_ID_CONFLICT");
  return prisma.rocketOutbound.upsert({ where: { id }, update: {}, create: {
    id, organizationId, accountId: input.accountId, phone: input.phone,
    sourceMessageId, campaignId: input.campaignId,
    content: input.content, sentAt: new Date(input.sentAt),
  } });
}

export async function enqueueReply(input: Reply) {
  if (input.eventType !== "reply") return { ignored: true, reason: "NOT_CUSTOMER_REPLY" };
  if (!await eligibility(input.accountId, input.phone, input.occurredAt)) return { ignored: true, reason: "NO_ELIGIBLE_OUTREACH" };
  const id = key(organizationId, input.accountId, input.eventId);
  const row = await prisma.rocketImportEvent.upsert({ where: { id }, update: {}, create: {
    id, organizationId, accountId: input.accountId, externalEventId: input.eventId,
    externalMessageId: input.externalMessageId, payload: input,
  } });
  const previous = row.payload as unknown as Reply;
  if (previous.externalMessageId !== input.externalMessageId || previous.phone !== input.phone) throw new ImportFailure("EVENT_ID_CONFLICT");
  return { eventId: id, status: row.status, duplicate: row.status === "processed" };
}

async function processReply(id: string) {
  for (let retry = 0; retry < 3; retry++) {
    try {
      return await prisma.$transaction(async tx => {
        const event = await tx.rocketImportEvent.findUniqueOrThrow({ where: { id } });
        if (event.status === "processed") return;
        const input = replySchema.parse(event.payload);
        const outbound = await eligibility(input.accountId, input.phone, input.occurredAt, tx);
        if (!outbound) throw new ImportFailure("OUTREACH_OR_SETTINGS_CHANGED");
        const referenceId = key(organizationId, input.accountId, "whatsapp-web", input.externalMessageId);
        const prior = await tx.rocketMessage.findUnique({ where: { id: referenceId } });
        if (prior) {
          await tx.rocketImportEvent.update({ where: { id }, data: { status: "processed", lockedAt: null, lastErrorCode: "DUPLICATE_MESSAGE" } });
          return;
        }
        let contact = await tx.rocketContact.findUnique({ where: { organizationId_phone: { organizationId, phone: input.phone } } });
        if (!contact) {
          const candidates = await tx.customer.findMany({ where: { OR: [{ phone: { not: "" } }, { whatsapp: { not: "" } }] }, select: { id: true, phone: true, whatsapp: true }, take: 5001 });
          if (candidates.length > 5000) throw new ImportFailure("LEGACY_PHONE_BACKFILL_REQUIRED");
          const matches = candidates.filter(customer => [customer.phone, customer.whatsapp].some(value => {
            try { return normalizeRocketPhone(value) === input.phone; } catch { return false; }
          }));
          if (matches.length > 1) throw new ImportFailure("AMBIGUOUS_EXISTING_CUSTOMER");
          const customer = matches[0] || await tx.customer.create({ data: {
            name: input.name || input.phone, phone: input.phone, whatsapp: input.phone,
            firstContact: new Date(input.occurredAt), lastContact: new Date(input.occurredAt),
            metadata: { source: "rocketsender", campaignId: outbound.campaignId },
          } });
          contact = await tx.rocketContact.create({ data: { organizationId, phone: input.phone, customerId: customer.id } });
        }
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: contact.customerId } });
        if (customer.isBlocked) throw new ImportFailure("CUSTOMER_BLOCKED");
        const metadata = customer.metadata && typeof customer.metadata === "object" && !Array.isArray(customer.metadata) ? customer.metadata : {};
        await tx.customer.update({ where: { id: customer.id }, data: {
          tags: ensureCustomerTag(customer.tags, "active"),
          lastContact: new Date(Math.max(customer.lastContact.getTime(), Date.parse(input.occurredAt))),
          ...((!customer.name || customer.name === "Unknown" || customer.name === input.phone) && input.name ? { name: input.name } : {}),
          metadata: { ...metadata, rocketSender: { source: "rocketsender", accountId: input.accountId, campaignId: outbound.campaignId } },
        } });
        const threadKey = { organizationId, accountId: input.accountId, phone: input.phone, externalId: input.conversationId };
        let thread = await tx.rocketThread.findUnique({ where: { organizationId_accountId_phone_externalId: threadKey } });
        if (!thread) {
          const conversationId = key(organizationId, input.accountId, input.phone, input.conversationId);
          await tx.conversation.upsert({ where: { id: conversationId }, update: {}, create: {
            id: conversationId, channel: "whatsapp", customerId: customer.id,
            customerName: input.name || customer.name, customerContact: input.phone,
            metadata: { source: "rocketsender", whatsappAccountId: input.accountId, campaignId: outbound.campaignId, externalConversationId: input.conversationId },
          } });
          thread = await tx.rocketThread.create({ data: { ...threadKey, conversationId } });
        }
        // The sent record is not an Owly customer/message until a reply qualifies.
        if (outbound.content) {
          const originalId = key("outbound", organizationId, input.accountId, outbound.sourceMessageId);
          await tx.message.upsert({ where: { id: originalId }, update: {}, create: { id: originalId, conversationId: thread.conversationId, role: "assistant", content: outbound.content, createdAt: outbound.sentAt, toolCalls: { source: "rocketsender", externalMessageId: outbound.sourceMessageId, campaignId: outbound.campaignId, imported: true } } });
        }
        const messageId = key("message", organizationId, input.accountId, input.externalMessageId);
        await tx.message.upsert({ where: { id: messageId }, update: {}, create: {
          id: messageId, conversationId: thread.conversationId, role: "customer", content: input.content, createdAt: new Date(input.occurredAt),
          toolCalls: { source: "whatsapp-web", externalMessageId: input.externalMessageId, externalEventId: input.eventId, campaignId: outbound.campaignId, imported: true },
        } });
        await tx.rocketMessage.create({ data: { id: referenceId, organizationId, accountId: input.accountId, source: "whatsapp-web", externalMessageId: input.externalMessageId, messageId } });
        await tx.conversation.update({ where: { id: thread.conversationId }, data: { updatedAt: new Date() } });
        await tx.rocketImportEvent.update({ where: { id }, data: { status: "processed", lockedAt: null, lastErrorCode: "", customerId: customer.id, conversationId: thread.conversationId } });
      }, { isolationLevel: "Serializable", timeout: 10000 });
    } catch (error) {
      if (retry < 2 && ["P2002", "P2034"].includes((error as { code?: string }).code || "")) continue;
      throw error;
    }
  }
}

export async function drainRocketQueue() {
  const settings = await prisma.rocketIntegration.findUnique({ where: { id: "default" } });
  if (!settings || settings.mode === "disabled") return;
  const channel = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
  const config = channel?.config as Record<string, unknown> | undefined;
  if (config?.browserDesiredEnabled === false || config?.browserEnabled === false) return;
  const now = new Date();
  const due = await prisma.rocketImportEvent.findMany({ where: { organizationId, OR: [
    { status: "pending", nextAttemptAt: { lte: now } },
    { status: "processing", lockedAt: { lt: new Date(now.getTime() - 300000) } },
  ] }, orderBy: { createdAt: "asc" }, take: 10 });
  for (const event of due) {
    const claimed = await prisma.rocketImportEvent.updateMany({ where: { id: event.id, status: event.status, lockedAt: event.lockedAt }, data: { status: "processing", lockedAt: now } });
    if (!claimed.count) continue;
    try { await processReply(event.id); }
    catch (error) {
      const attempts = event.attempts + 1;
      const code = error instanceof ImportFailure ? error.code : "DATABASE_OR_PROCESSING_ERROR";
      await prisma.rocketImportEvent.update({ where: { id: event.id }, data: {
        attempts, status: attempts >= 5 ? "dead" : "pending", lockedAt: null,
        lastErrorCode: code, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 15000 * 2 ** attempts)),
      } });
    }
  }
}

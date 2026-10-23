import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { PUT, POST } from "@/app/api/integrations/notion/route";
import { createRequest } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const headers = { Authorization: "Bearer notion-secret", "Notion-Version": "2026-03-11" };
const schema = {
  Name: { type: "title" },
  "Owly ID": { type: "rich_text" },
  Phone: { type: "phone_number" },
  Email: { type: "email" },
  Tags: { type: "rich_text" },
  Channel: { type: "rich_text" },
  Status: { type: "rich_text" },
  Summary: { type: "rich_text" },
  Messages: { type: "rich_text" },
  Type: { type: "rich_text" },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settings = { id: "default", token: "notion-secret", databaseId: "database1", enabled: true, syncOffset: 0, conversationSyncOffset: 0, lastSyncAt: null, lastSyncError: "" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ userId: "admin", role: "admin", username: "admin", name: "Admin", authMethod: "cookie" });
  db.notionIntegration.findUnique.mockResolvedValue(null);
  db.notionIntegration.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => args.create);
  db.notionIntegration.update.mockResolvedValue(settings);
  db.customer.count.mockResolvedValue(1);
  db.conversation.count.mockResolvedValue(0);
  db.conversation.findMany.mockResolvedValue([]);
  db.customer.findMany.mockResolvedValue([{ id: "customer1", name: "Acme", phone: "+36301234567", whatsapp: "+36301234567", email: "", tags: "vip", lastContact: new Date("2026-10-20T12:00:00Z") }]);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/databases/database1")) return response({ data_sources: [{ id: "source1" }] });
    if (url.endsWith("/data_sources/source1")) return response({ id: "source1", properties: schema });
    if (url.endsWith("/data_sources/source1/query")) return response({ results: [] });
    if (url.endsWith("/pages")) return response({ id: "page1" });
    return response({ id: "page1" });
  }));
});

describe("Notion CRM integration", () => {
  it("validates and stores the integration while never returning its token", async () => {
    const req = createRequest("/api/integrations/notion", { method: "PUT", body: { token: "notion-secret", databaseId: "database1", enabled: true } });
    const result = await PUT(req);
    expect(result.status).toBe(200);
    expect(await result.json()).not.toHaveProperty("settings.token");
    expect(db.notionIntegration.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ token: "notion-secret", enabled: true }) }));
    expect(fetch).toHaveBeenCalledWith("https://api.notion.com/v1/databases/database1", expect.objectContaining({ headers: expect.objectContaining(headers) }));
  });

  it("refuses to enable a database without the deduplication column", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/databases/database1")
      ? response({ data_sources: [{ id: "source1" }] })
      : response({ properties: { Name: { type: "title" } } })));
    db.notionIntegration.findUnique.mockResolvedValue(null);
    const req = createRequest("/api/integrations/notion", { method: "PUT", body: { token: "notion-secret", databaseId: "database1", enabled: true } });
    const result = await PUT(req);
    expect(result.status).toBe(422);
    expect(db.notionIntegration.upsert).not.toHaveBeenCalled();
  });

  it("creates CRM rows with Owly IDs when a sync is requested", async () => {
    db.notionIntegration.findUnique.mockResolvedValue(settings);
    const req = createRequest("/api/integrations/notion", { method: "POST", body: { action: "sync" } });
    const result = await POST(req);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ created: 1, updated: 0, failed: 0 });
    const calls = vi.mocked(fetch).mock.calls;
    const createCall = calls.find(([input]) => String(input).endsWith("/pages"));
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      parent: { type: "data_source_id", data_source_id: "source1" },
      properties: { "Owly ID": { rich_text: [{ text: { content: "customer1" } }] } },
    });
  });

  it("updates an existing page instead of duplicating the customer", async () => {
    db.notionIntegration.findUnique.mockResolvedValue(settings);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/databases/database1")) return response({ data_sources: [{ id: "source1" }] });
      if (url.endsWith("/data_sources/source1")) return response({ properties: schema });
      if (url.endsWith("/data_sources/source1/query")) return response({ results: [{ id: "page1" }] });
      return response({ id: "page1" });
    }));
    const result = await POST(createRequest("/api/integrations/notion", { method: "POST", body: { action: "sync" } }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => String(input).endsWith("/pages/page1") && init?.method === "PATCH")).toBe(true);
  });

  it("synchronizes conversation previews and recent messages into CRM rows", async () => {
    db.notionIntegration.findUnique.mockResolvedValue(settings);
    db.customer.count.mockResolvedValue(0);
    db.customer.findMany.mockResolvedValue([]);
    db.conversation.count.mockResolvedValue(1);
    db.conversation.findMany.mockResolvedValue([{
      id: "conversation1", customerName: "Acme", customerContact: "+36301234567", channel: "whatsapp", status: "active", summary: "Follow-up needed", updatedAt: new Date("2026-10-21T12:00:00Z"),
      messages: [{ role: "customer", content: "Please call me tomorrow." }],
    }]);
    const result = await POST(createRequest("/api/integrations/notion", { method: "POST", body: { action: "sync" } }));
    expect(result.status).toBe(200);
    const createCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/pages"));
    expect(JSON.parse(String(createCall?.[1]?.body)).properties).toMatchObject({
      "Owly ID": { rich_text: [{ text: { content: "conversation1" } }] },
      Summary: { rich_text: [{ text: { content: "Follow-up needed" } }] },
      Messages: { rich_text: [{ text: { content: "customer: Please call me tomorrow." } }] },
      Type: { rich_text: [{ text: { content: "Beszélgetés" } }] },
    });
  });
});

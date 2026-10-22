import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRequest } from "../helpers/request";
import { GET as search } from "@/app/api/search/route";
import { GET as notifications } from "@/app/api/notifications/route";
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
beforeEach(() => {
  vi.clearAllMocks();
  db.customer.findMany.mockResolvedValue([]); db.conversation.findMany.mockResolvedValue([]); db.ticket.findMany.mockResolvedValue([]);
  db.conversation.count.mockResolvedValue(0); db.ticket.count.mockResolvedValue(0);
});
describe("Header tools", () => {
  it("links search results directly to the matching customer record", async () => {
    db.customer.findMany.mockResolvedValue([{ id: "customer1", name: "Test", phone: "+12025550123", email: "" }]);
    const data = await (await search(createRequest("/api/search?q=Test"))).json();
    expect(data.items[0]).toMatchObject({ kind: "Ügyfél", title: "Test", href: "/customers?customer=customer1" });
  });
  it("does not scan customer data for an empty search", async () => {
    expect((await (await search(createRequest("/api/search?q=a"))).json()).items).toEqual([]);
    expect(db.customer.findMany).not.toHaveBeenCalled();
  });
  it("reports no notifications when there are no actual attention items", async () => {
    expect(await (await notifications(createRequest("/api/notifications"))).json()).toEqual({ total: 0, items: [] });
  });
  it("counts real urgent tickets and human-escalated conversations", async () => {
    db.conversation.findMany.mockResolvedValue([{ id: "conversation1", customerName: "Test" }]);
    db.conversation.count.mockResolvedValue(1);
    expect(await (await notifications(createRequest("/api/notifications"))).json()).toMatchObject({ total: 1, items: [{ href: "/conversations?conversation=conversation1" }] });
  });
});

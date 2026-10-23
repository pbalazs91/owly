import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRequest } from "../helpers/request";
import { POST } from "@/app/api/customers/import/route";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("Independent Owly customer import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.customer.findMany.mockResolvedValue([]);
    db.customer.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "customer-1", ...args.data }));
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  });

  it("creates a normal Owly customer without RocketSender setup or consent metadata", async () => {
    const response = await POST(createRequest("/api/customers/import", {
      method: "POST", body: { contacts: [{ name: "Anna Kovács", companyName: "Acme Kft.", businessType: "Consulting", companyAddress: "Budapest", website: "https://acme.hu", phone: "+36301234567", tags: "lead" }] },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 1, imported: 1, customerIds: ["customer-1"] });
    expect(db.customer.create.mock.calls[0][0].data).toMatchObject({ name: "Anna Kovács", companyName: "Acme Kft.", businessType: "Consulting", companyAddress: "Budapest", website: "https://acme.hu", phone: "+36301234567", tags: "lead" });
    expect(db.rocketContact.upsert).not.toHaveBeenCalled();
    expect(db.rocketIntegration.findUnique).not.toHaveBeenCalled();
  });

  it("does not impose a 5,000-customer ceiling on duplicate matching", async () => {
    db.customer.findMany.mockResolvedValue(Array.from({ length: 6001 }, (_, index) => ({
      id: `existing-${index}`, name: `Existing ${index}`, companyName: "", businessType: "", companyAddress: "", website: "",
      email: `existing-${index}@example.com`, phone: `+3630123${String(index).padStart(4, "0")}`, whatsapp: "", tags: "", metadata: {},
    })));
    const response = await POST(createRequest("/api/customers/import", {
      method: "POST", body: { contacts: [{ name: "Anna", phone: "+36301234567", email: "anna@example.com" }] },
    }));
    expect(response.status).toBe(200);
    const query = db.customer.findMany.mock.calls.at(-1)?.[0];
    expect(query).not.toHaveProperty("take");
  });
});

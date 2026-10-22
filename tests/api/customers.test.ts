import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/customers/[id]/route";

describe("Customer detail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes note counts required by the detail panel, including zero notes", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: "customer-1", name: "Test", email: "", phone: "", whatsapp: "",
      notes: [], _count: { notes: 0 },
    } as never);
    const response = await GET(new NextRequest("http://localhost/api/customers/customer-1"), {
      params: Promise.resolve({ id: "customer-1" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json())._count.notes).toBe(0);
    expect(prisma.customer.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ _count: { select: { notes: true } } }),
    }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/knowledge/entries/bulk/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/knowledge/entries/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("bulk knowledge document entries API", () => {
  it("creates all document chunks in one request", async () => {
    vi.mocked(prisma.category.findUnique).mockResolvedValue({ id: "category-1" } as never);
    vi.mocked(prisma.knowledgeEntry.createMany).mockResolvedValue({ count: 2 } as never);
    const response = await POST(request({
      categoryId: "category-1",
      priority: 1,
      entries: [
        { title: "Guide (1/2)", content: "Első rész" },
        { title: "Guide (2/2)", content: "Második rész" },
      ],
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: 2 });
    expect(prisma.knowledgeEntry.createMany).toHaveBeenCalledWith({
      data: [
        { categoryId: "category-1", title: "Guide (1/2)", content: "Első rész", priority: 1 },
        { categoryId: "category-1", title: "Guide (2/2)", content: "Második rész", priority: 1 },
      ],
    });
  });

  it("rejects oversized chunks without writing entries", async () => {
    const response = await POST(request({
      categoryId: "category-1",
      entries: [
        { title: "Guide (1/2)", content: "a".repeat(10001) },
        { title: "Guide (2/2)", content: "valid" },
      ],
    }));
    expect(response.status).toBe(400);
    expect(prisma.knowledgeEntry.createMany).not.toHaveBeenCalled();
  });
});

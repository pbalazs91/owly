import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { POST } from "@/app/api/knowledge/import/route";

const request = (file: File) => {
  const form = new FormData(); form.set("file", file);
  return new NextRequest("http://localhost/api/knowledge/import", { method: "POST", body: form });
};
beforeEach(() => { vi.mocked(isAuthenticated).mockReturnValue(true); });
describe("knowledge import API", () => {
  it("extracts a preview without writing any knowledge entry", async () => {
    const response = await POST(request(new File(["Teszt tudásanyag"], "knowledge.txt")));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: "knowledge", content: "Teszt tudásanyag" });
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "knowledge:create");
  });
  it("requires authentication before reading the uploaded file", async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);
    vi.mocked(requireAuth).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await POST(request(new File(["Text"], "knowledge.txt")))).status).toBe(401);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchList } from "@/lib/fetch-list";

afterEach(() => vi.unstubAllGlobals());
describe("knowledge list API loading", () => {
  it("unwraps and combines pages without dropping later entries or category filters", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "a" }], pagination: { totalPages: 2 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "b" }], pagination: { totalPages: 2 } }) });
    vi.stubGlobal("fetch", fetch);
    expect(await fetchList("/api/knowledge/entries?categoryId=cat")).toEqual([{ id: "a" }, { id: "b" }]);
    expect(fetch.mock.calls[1][0]).toBe("/api/knowledge/entries?categoryId=cat&page=2&limit=100");
  });
  it("returns an empty array for an empty database", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [], pagination: { totalPages: 0 } }) }));
    expect(await fetchList("/api/knowledge/categories")).toEqual([]);
  });
  it("reports failed requests instead of passing an error object to the UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchList("/api/knowledge/categories")).rejects.toThrow("nem tölthető be");
  });
});

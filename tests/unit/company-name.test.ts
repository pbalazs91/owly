import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateToken, lookupPublicCompany, verifyCandidate } from "@/lib/company-name";

afterEach(() => vi.unstubAllGlobals());
describe("Public company evidence", () => {
  it("accepts only exact public-company telephone matches with a usable source", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: { bindings: [
      { company: { value: "http://www.wikidata.org/entity/Q123" }, companyLabel: { value: "Example Company" }, tel: { value: "+1-202-555-0123" } },
      { company: { value: "http://www.wikidata.org/entity/Q124" }, companyLabel: { value: "Wrong number" }, tel: { value: "+1-202-555-0124" } },
      { company: { value: "https://untrusted.example/Q125" }, companyLabel: { value: "Wrong source" }, tel: { value: "+1-202-555-0123" } },
    ] } })));
    vi.stubGlobal("fetch", fetch);
    expect(await lookupPublicCompany("+12025550123")).toEqual([{ name: "Example Company", phone: "+12025550123", sourceUrl: "https://www.wikidata.org/wiki/Q123", provider: "wikidata" }]);
    const query = new URL(fetch.mock.calls[0][0]).searchParams.get("query")!;
    expect(query).toContain("wd:Q4830453");
    expect(query).toContain("FILTER NOT EXISTS");
    expect(query).toContain("wd:Q5");
  });
  it("does not send invalid phone input to a search provider", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(lookupPublicCompany('bad"query')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not turn provider failures into invented names", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
    await expect(lookupPublicCompany("+12025550123")).rejects.toThrow("PUBLIC_COMPANY_SOURCE_UNAVAILABLE");
  });
  it("binds human-approved suggestions to a customer, phone, and signed source", () => {
    const candidate = { name: "Example Company", phone: "+12025550123", sourceUrl: "https://www.wikidata.org/wiki/Q123", provider: "wikidata" as const };
    const token = candidateToken("customer1", candidate);
    expect(verifyCandidate(token, "customer1", "+1 202 555 0123")).toEqual(candidate);
    expect(verifyCandidate(token, "customer2", candidate.phone)).toBeNull();
    expect(verifyCandidate(token, "customer1", "+12025550124")).toBeNull();
    expect(verifyCandidate(token + "tampered", "customer1", candidate.phone)).toBeNull();
  });
});

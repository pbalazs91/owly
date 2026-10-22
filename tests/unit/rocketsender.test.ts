import { describe, expect, it } from "vitest";
import { normalizeRocketPhone, key } from "@/lib/rocketsender/importer";
import { parseRegistryFile } from "@/lib/rocketsender/registry-file";

describe("RocketSender identity and ledger", () => {
  it("normalizes formatted international numbers and WhatsApp JIDs identically", () => {
    expect(normalizeRocketPhone("+1 (202) 555-0123")).toBe("+12025550123");
    expect(normalizeRocketPhone("12025550123@c.us")).toBe("+12025550123");
    expect(() => normalizeRocketPhone("unknown@lid")).toThrow();
  });
  it("separates organizations and WhatsApp accounts in deterministic IDs", () => {
    expect(key("org1", "account1", "same")).not.toBe(key("org2", "account1", "same"));
    expect(key("org1", "account1", "same")).not.toBe(key("org1", "account2", "same"));
  });
  it("preserves CSV quotes and original timestamps without inventing send times", () => {
    const rows = parseRegistryFile('phone,status,sentAt,content\r\n+12025550123,sent,2026-10-20T12:00:00Z,"Hello, ""Test"""', '+12025550100', 'campaign');
    expect(rows[0]).toMatchObject({ accountId: '+12025550100', campaignId: 'campaign', content: 'Hello, "Test"', sentAt: '2026-10-20T12:00:00Z' });
    expect(() => parseRegistryFile('phone\n+12025550123', 'account', 'campaign')).toThrow();
  });
});

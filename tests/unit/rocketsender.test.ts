import { describe, expect, it } from "vitest";
import { ensureCustomerTag, normalizeRocketPhone, key } from "@/lib/rocketsender/importer";
import { parseRegistryFile } from "@/lib/rocketsender/registry-file";
import { exportRocketContacts, parseRocketContactFile } from "@/lib/rocketsender/contact-file";

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
  it("imports contacts without treating a missing opt-in as consent", () => {
    const [contact] = parseRocketContactFile('phone,name,company,whatsappConsent,consentSource,consentedAt\r\n+36 30 123 4567,"Acme, Kft.",,,');
    expect(contact).toMatchObject({ phone: "+36301234567", name: "Acme, Kft.", whatsappConsent: false });
    expect(() => parseRocketContactFile("phone,name\nnot-a-number,Acme")).toThrow();
  });
  it("requires evidence details before an imported opt-in is exportable", () => {
    expect(() => parseRocketContactFile("phone,whatsappConsent\n+36301234567,true")).toThrow(/consentSource/);
    const [contact] = parseRocketContactFile("phone,whatsappConsent,consentSource,consentedAt\n+36301234567,true,Website form,2026-10-20T12:00:00Z");
    expect(contact).toMatchObject({ whatsappConsent: true, consentSource: "Website form" });
  });
  it("adds the active label once and exports the public company evidence", () => {
    expect(ensureCustomerTag("VIP, Active", "active")).toBe("VIP, Active");
    expect(ensureCustomerTag("VIP", "active")).toBe("VIP, active");
    const csv = exportRocketContacts([{ phone: "+36301234567", name: "Acme", email: "", metadata: { companyNameEvidence: { name: "Acme Kft.", sourceUrl: "https://www.wikidata.org/wiki/Q1" }, rocketSenderContact: { consentSource: "Website", consentedAt: "2026-10-20" } } }]);
    expect(csv).toContain('"+36301234567","Acme","","Acme Kft.","true","Website","2026-10-20"');
  });
});

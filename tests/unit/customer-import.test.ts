import { describe, expect, it } from "vitest";
import { getCustomerImportCsvHeaders, MAX_CUSTOMER_IMPORT_BYTES, parseCustomerImportCsv } from "@/lib/customer-import";

describe("Owly customer CSV import", () => {
  it("parses ordinary contacts without RocketSender consent columns", () => {
    const [row] = parseCustomerImportCsv('name,email,phone,company,tags\r\n"Acme, Kft.",hello@acme.hu,+36 30 123 4567,Acme,lead;active');
    expect(row).toEqual({ name: "Acme, Kft.", companyName: "Acme", businessType: "", companyAddress: "", website: "", email: "hello@acme.hu", phone: "+36301234567", whatsapp: "", company: "Acme", tags: "lead" });
  });
  it("reads company profile fields and validates website URLs", () => {
    expect(parseCustomerImportCsv("name,companyName,businessType,companyAddress,website,email\nAnna,Acme Kft.,Kereskedelem,Budapest,https://acme.hu,anna@example.com")[0]).toMatchObject({ companyName: "Acme Kft.", businessType: "Kereskedelem", companyAddress: "Budapest", website: "https://acme.hu" });
    expect(() => parseCustomerImportCsv("phone,website\n+36301234567,javascript:alert(1)")).toThrow(/weboldal címe/i);
  });
  it("maps arbitrary CSV columns to Owly fields", () => {
    const [row] = parseCustomerImportCsv("Ügyfél,Weboldal,Kategória,Kapcsolat\nAnna,https://example.hu,Könyvelés,+36301234567", {
      name: "Ügyfél", website: "Weboldal", businessType: "Kategória", phone: "Kapcsolat",
    });
    expect(row).toMatchObject({ name: "Anna", website: "https://example.hu", businessType: "Könyvelés", phone: "+36301234567" });
  });
  it("automatically reads semicolon-delimited CSV exported by spreadsheet apps", () => {
    const csv = 'Ügyfél;E-mail;Telefon;Cégnév\r\n"Acme; Kft.";hello@acme.hu;+36 30 123 4567;Acme Kft.';
    expect(getCustomerImportCsvHeaders(csv)).toEqual(["Ügyfél", "E-mail", "Telefon", "Cégnév"]);
    expect(parseCustomerImportCsv(csv, { name: "Ügyfél", email: "E-mail", phone: "Telefon", companyName: "Cégnév" })[0]).toMatchObject({
      name: "Acme; Kft.", email: "hello@acme.hu", phone: "+36301234567", companyName: "Acme Kft.",
    });
  });
  it("accepts email-only contacts and prevents importing the active system tag", () => {
    expect(parseCustomerImportCsv("email,tags\nhello@example.com,active")[0]).toMatchObject({ email: "hello@example.com", phone: "", tags: "" });
  });
  it("requires a contact method and international phone format", () => {
    expect(() => parseCustomerImportCsv("name,email\nAcme,")).toThrow(/Minden kontakt sorában/);
    expect(() => parseCustomerImportCsv("phone\n06301234567")).toThrow(/országkódos/i);
  });
  it("supports large files beyond one API batch and caps imports at 20,000 contacts", () => {
    expect(MAX_CUSTOMER_IMPORT_BYTES).toBe(25 * 1024 * 1024);
    const rows = Array.from({ length: 251 }, (_, index) => `Contact ${index},+3630${String(index).padStart(7, "0")}`);
    const csv = `name,phone\n${rows.join("\n")}`;
    expect(parseCustomerImportCsv(csv)).toHaveLength(251);

    const tooManyRows = Array.from({ length: 20_001 }, (_, index) => `Contact ${index},+3630${String(index).padStart(7, "0")}`);
    expect(() => getCustomerImportCsvHeaders(`name,phone\n${tooManyRows.join("\n")}`)).toThrow(/20 000/);
  });
  it("accepts a CSV larger than 10 MB", () => {
    const csv = `name,phone\n${"A".repeat(10 * 1024 * 1024)},+36301234567`;
    expect(new TextEncoder().encode(csv).byteLength).toBeGreaterThan(10 * 1024 * 1024);
    expect(parseCustomerImportCsv(csv)).toHaveLength(1);
  });
});

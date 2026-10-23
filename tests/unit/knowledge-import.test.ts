import { describe, expect, it } from "vitest";
import { extractKnowledge, MAX_IMPORT_BYTES } from "@/lib/knowledge-import";

// A small real PDF validates extraction, not just a mocked parser response.
function pdf(text: string) {
  const stream = text ? `BT /F1 12 Tf 50 750 Td (${text}) Tj ET` : "";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return result;
}
describe("knowledge file import", () => {
  it("preserves Hungarian UTF-8 text and normalizes line endings", async () => {
    expect(await extractKnowledge(new File(["Árvíztűrő\r\ntükörfúrógép"], "adatok.txt"))).toEqual({ title: "adatok", content: "Árvíztűrő\ntükörfúrógép" });
  });
  it("extracts text from a real PDF", async () => {
    const result = await extractKnowledge(new File([pdf("Owly import works")], "guide.pdf"));
    expect(result.content).toContain("Owly import works");
  }, 30000);
  it("reports an image-only or empty PDF instead of saving an empty entry", async () => {
    await expect(extractKnowledge(new File([pdf("")], "scan.pdf"))).rejects.toThrow("OCR");
  });
  it("rejects unsupported, oversized, binary and invalid PDF files", async () => {
    await expect(extractKnowledge(new File(["data"], "program.exe"))).rejects.toThrow("PDF, TXT");
    await expect(extractKnowledge(new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "large.txt"))).rejects.toThrow("25 MB");
    await expect(extractKnowledge(new File(["not a pdf"], "fake.pdf"))).rejects.toThrow("érvényes PDF");
    await expect(extractKnowledge(new File(["abc\0def"], "binary.txt"))).rejects.toThrow("egyszerű szöveg");
  });
});

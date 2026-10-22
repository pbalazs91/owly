export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_CHARS = 100000;

export class ImportError extends Error {}

export async function extractKnowledge(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "txt", "md", "csv"].includes(extension || "")) throw new ImportError("PDF, TXT, MD vagy CSV fájlt válassz.");
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new ImportError("A fájl legfeljebb 2 MB lehet, és nem lehet üres.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let content: string;
  if (extension === "pdf") {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new ImportError("Ez nem érvényes PDF-fájl.");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes, isEvalSupported: false });
    try {
      const info = await parser.getInfo();
      if (info.total > 50) throw new ImportError("Egy PDF legfeljebb 50 oldalas lehet. Oszd kisebb részekre.");
      content = (await parser.getText({ pageJoiner: "\n\n" })).text;
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError("A PDF nem olvasható. Sérült vagy jelszóval védett fájl helyett tölts fel szöveges változatot.");
    } finally {
      await parser.destroy();
    }
  } else {
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new ImportError("A szövegfájlt UTF-8 kódolással mentsd el, majd töltsd fel újra."); }
    if (content.includes("\0")) throw new ImportError("A fájl nem egyszerű szövegfájl.");
  }
  content = content.replace(/\r\n?/g, "\n").trim();
  if (!content) throw new ImportError("Nem található kiolvasható szöveg. A beszkennelt PDF-ekhez előbb szövegfelismerés (OCR) szükséges.");
  if (content.length > MAX_IMPORT_CHARS) throw new ImportError("A dokumentum túl hosszú (legfeljebb 100 000 karakter). Oszd kisebb részekre.");
  return { title: file.name.replace(/\.[^.]+$/, "").slice(0, 200), content };
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { extractKnowledge, ImportError, MAX_IMPORT_BYTES } from "@/lib/knowledge-import";

export const runtime = "nodejs";
let importing = false;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "knowledge:create");
  if (!isAuthenticated(auth)) return auth;
  if (importing) return NextResponse.json({ error: "Másik fájl beolvasása zajlik. Próbáld újra rövidesen." }, { status: 429 });
  importing = true;
  try {
    // Bound the actual streamed body too; Content-Length can be absent or incorrect.
    const reader = request.body?.getReader();
    if (!reader) throw new ImportError("Hiányzik a fájl.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMPORT_BYTES + 65536) {
        await reader.cancel();
        return NextResponse.json({ error: "A fájl legfeljebb 2 MB lehet." }, { status: 413 });
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ImportError("Válassz ki egy fájlt.");
    return NextResponse.json(await extractKnowledge(file), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ImportError ? error.message : "A fájl beolvasása nem sikerült. Próbálj másik fájlt." }, { status: 400 });
  } finally { importing = false; }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { readBoundedJson } from "@/lib/read-json";
import { MAX_IMPORT_CHARS, MAX_KNOWLEDGE_CHUNK_CHARS, MAX_KNOWLEDGE_CHUNKS } from "@/lib/knowledge-import-limits";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, "knowledge:create");
  if (!isAuthenticated(auth)) return auth;

  try {
    const body = await readBoundedJson(request, 600000);
    const { categoryId, entries, priority } = body ?? {};
    if (typeof categoryId !== "string" || !categoryId) {
      return NextResponse.json({ error: "Válassz tudásbázis-kategóriát." }, { status: 400 });
    }
    if (!Array.isArray(entries) || entries.length < 2 || entries.length > MAX_KNOWLEDGE_CHUNKS) {
      return NextResponse.json({ error: "A dokumentum részeinek száma érvénytelen." }, { status: 400 });
    }
    if (!entries.every((entry) =>
      entry && typeof entry.title === "string" && entry.title.trim().length > 0 &&
      entry.title.length <= 200 && typeof entry.content === "string" &&
      entry.content.length > 0 && entry.content.length <= MAX_KNOWLEDGE_CHUNK_CHARS
    )) {
      return NextResponse.json({ error: "A dokumentum egyik része hibás vagy túl hosszú." }, { status: 400 });
    }
    const totalChars = entries.reduce((total: number, entry: { content: string }) => total + entry.content.length, 0);
    if (totalChars > MAX_IMPORT_CHARS) {
      return NextResponse.json({ error: "A dokumentum túl hosszú (legfeljebb 100 000 karakter)." }, { status: 400 });
    }

    const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) return NextResponse.json({ error: "A kiválasztott kategória nem található." }, { status: 404 });

    const result = await prisma.knowledgeEntry.createMany({
      data: entries.map((entry: { title: string; content: string }) => ({
        categoryId,
        title: entry.title.trim(),
        content: entry.content,
        priority: typeof priority === "number" && Number.isInteger(priority) ? priority : 0,
      })),
    });
    return NextResponse.json({ created: result.count }, { status: 201 });
  } catch (error) {
    logger.error("Failed to create knowledge document entries:", error);
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return NextResponse.json({ error: "A dokumentum túl nagy a feldolgozáshoz." }, { status: 413 });
    }
    return NextResponse.json({ error: "A dokumentum részeinek mentése nem sikerült." }, { status: 500 });
  }
}

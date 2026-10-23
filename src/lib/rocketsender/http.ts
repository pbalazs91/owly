import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { hasPermission } from "@/lib/rbac";

export const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function readBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128000) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function authorize(request: NextRequest, allowBridge = false) {
  if (allowBridge) {
    try {
      const audience = "owly-whatsapp-browser";
      if (!process.env.JWT_SECRET) return json({ error: "Nincs szerverkonfiguráció." }, 503);
      const key = createHmac("sha256", process.env.JWT_SECRET).update(audience).digest("hex");
      const token = jwt.verify(request.headers.get("x-api-key") || "", key, { algorithms: ["HS256"], audience }) as jwt.JwtPayload;
      const channel = await prisma.channel.findUnique({ where: { type: "whatsapp" } });
      const config = channel?.config as Record<string, unknown> | undefined;
      if (token.scope === "whatsapp-browser" && token.jti && token.jti === config?.browserTokenId && typeof token.userId === "string") {
        const admin = await prisma.admin.findUnique({ where: { id: token.userId }, select: { role: true } });
        if (admin && hasPermission(admin.role, "channels:update")) return { userId: token.userId, role: admin.role };
      }
    } catch { /* Normal Owly API keys/cookies are checked by the common guard. */ }
  }
  const auth = await requireAuth(request, "settings:update");
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth.role, "settings:update")) return json({ error: "Nincs jogosultság az integráció kezeléséhez." }, 403);
  return auth;
}
export function failure(error: unknown) {
  if (error instanceof SyntaxError) return json({ error: "Hibás JSON-adat." }, 400);
  if (error instanceof Error && error.message === "BODY_TOO_LARGE") return json({ error: "A feltöltés legfeljebb 128 kB lehet." }, 413);
  return json({ error: "A művelet nem sikerült. Ellenőrizd az importnaplót és az adatbázis-migrációt." }, 503);
}

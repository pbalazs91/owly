import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const integrationId = "default";

export function createAiStudioSecret() {
  return `owly_as_${randomBytes(32).toString("base64url")}`;
}

export function hashAiStudioSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export async function authenticateAiStudioRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const providedSecret = bearer || request.headers.get("x-owly-backend-secret")?.trim() || "";
  if (!providedSecret || providedSecret.length > 200) return false;

  const integration = await prisma.aiStudioIntegration.findUnique({ where: { id: integrationId } });
  if (!integration?.enabled || !/^[a-f0-9]{64}$/.test(integration.secretHash)) return false;

  const expected = Buffer.from(integration.secretHash, "hex");
  const actual = Buffer.from(hashAiStudioSecret(providedSecret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  await prisma.aiStudioIntegration.update({ where: { id: integrationId }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return true;
}

export function aiStudioSecretHint(secret: string) {
  return secret.slice(-4);
}

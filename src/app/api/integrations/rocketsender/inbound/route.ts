import { NextRequest, NextResponse } from "next/server";
import { authorize, failure, json, readBody } from "@/lib/rocketsender/http";
import { drainRocketQueue, enqueueReply, replySchema } from "@/lib/rocketsender/importer";

export async function POST(request: NextRequest) {
  const auth = await authorize(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await readBody(request);
    // Receipts and outbound notifications never create customers or queue imports.
    if (["delivered", "read", "outbound"].includes(body.eventType)) return json({ ignored: true, reason: "NOT_CUSTOMER_REPLY" });
    const parsed = replySchema.safeParse(body);
    if (!parsed.success) return json({ error: "Hibás válaszesemény." }, 400);
    const result = await enqueueReply(parsed.data);
    if ("eventId" in result) {
      // Queue storage precedes processing. A processing failure is retained for retry.
      await drainRocketQueue().catch(() => {});
    }
    return json(result, "eventId" in result ? 202 : 200);
  } catch (error) { return failure(error); }
}

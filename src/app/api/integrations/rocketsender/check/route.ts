import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize, failure, json, readBody } from "@/lib/rocketsender/http";
import { eligibility, normalizeRocketPhone } from "@/lib/rocketsender/importer";

export async function POST(request: NextRequest) {
  const auth = await authorize(request, true);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = z.object({ accountId: z.string().max(100), phone: z.string().max(100), occurredAt: z.iso.datetime({ offset: true }) }).safeParse(await readBody(request));
    if (!parsed.success) return json({ error: "Hibás azonosítás." }, 400);
    let accountId: string, phone: string;
    try { accountId = normalizeRocketPhone(parsed.data.accountId); phone = normalizeRocketPhone(parsed.data.phone); }
    catch { return json({ eligible: false }); }
    return json({ eligible: !!await eligibility(accountId, phone, parsed.data.occurredAt) });
  } catch (error) { return failure(error); }
}

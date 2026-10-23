import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize, failure, json, readBody } from "@/lib/rocketsender/http";
import { outboundSchema, registerOutbound } from "@/lib/rocketsender/importer";

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = z.array(outboundSchema).min(1).max(100).safeParse(await readBody(request));
    if (!parsed.success) return json({ error: "Csak ténylegesen elküldött, időponttal és kampányazonosítóval ellátott küldések rögzíthetők." }, 400);
    for (const row of parsed.data) await registerOutbound(row);
    return json({ registered: parsed.data.length, customersCreated: 0 });
  } catch (error) { return failure(error); }
}

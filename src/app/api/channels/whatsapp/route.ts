import { NextResponse } from "next/server";
import {
  getWhatsAppStatus,
  initWhatsApp,
  disconnectWhatsApp,
} from "@/lib/channels/whatsapp";

export async function GET() {
  const status = getWhatsAppStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  if (action === "connect") {
    if (process.env.OWLY_WHATSAPP_MODE === "browser") {
      return NextResponse.json({ error: "Ezen a kiszolgálón a Chrome-bővítmény módot használd a WhatsApphoz." }, { status: 409 });
    }
    // The long-lived Render process initializes in the background. Let the UI
    // poll immediately, including QR updates and a recoverable startup error.
    void initWhatsApp().catch(() => {});
    return NextResponse.json(getWhatsAppStatus(), { status: 202 });
  }

  if (action === "disconnect") {
    await disconnectWhatsApp();
    return NextResponse.json({ status: "disconnected" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

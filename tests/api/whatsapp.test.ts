import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequest, parseJsonResponse } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  init: vi.fn(), status: vi.fn(), disconnect: vi.fn(),
}));
vi.mock("@/lib/channels/whatsapp", () => ({
  initWhatsApp: mocks.init,
  getWhatsAppStatus: mocks.status,
  disconnectWhatsApp: mocks.disconnect,
}));

describe("WhatsApp startup polling", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does not launch a server browser when browser-extension mode is required", async () => {
    vi.stubEnv("OWLY_WHATSAPP_MODE", "browser");
    try {
      const { POST } = await import("@/app/api/channels/whatsapp/route");
      const response = await POST(createRequest("/api/channels/whatsapp", {
        method: "POST", body: { action: "connect" },
      }));
      expect(response.status).toBe(409);
      expect(mocks.init).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns immediately during startup so the UI can poll for the QR code", async () => {
    let complete!: () => void;
    mocks.init.mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    mocks.status.mockReturnValue({ status: "connecting", qr: null });
    const { POST, GET } = await import("@/app/api/channels/whatsapp/route");
    const response = await POST(createRequest("/api/channels/whatsapp", {
      method: "POST", body: { action: "connect" },
    }));
    expect(response.status).toBe(202);
    expect((await parseJsonResponse(response)).status).toBe("connecting");
    mocks.status.mockReturnValue({ status: "qr_ready", qr: "test-qr" });
    expect((await parseJsonResponse(await GET())).qr).toBe("test-qr");
    complete();
  });

  it("exposes background startup failure through polling without an unhandled rejection", async () => {
    mocks.init.mockRejectedValue(new Error("startup failed"));
    mocks.status.mockReturnValue({ status: "error", qr: null });
    const { POST, GET } = await import("@/app/api/channels/whatsapp/route");
    expect((await POST(createRequest("/api/channels/whatsapp", {
      method: "POST", body: { action: "connect" },
    }))).status).toBe(202);
    expect((await parseJsonResponse(await GET())).status).toBe("error");
  });
});

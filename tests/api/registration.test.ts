import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRequest, parseJsonResponse } from "../helpers/request";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  isSetupComplete: vi.fn(),
}));

describe("bootstrap admin plus one registered account", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { isSetupComplete } = await import("@/lib/auth");
    vi.mocked(isSetupComplete).mockResolvedValue(false);
    vi.mocked(prisma.admin.count).mockReset();
    vi.mocked(prisma.admin.count).mockResolvedValue(1);
    vi.mocked(prisma.admin.create).mockReset();
    vi.mocked(prisma.admin.create).mockResolvedValue({
      id: "owner",
      username: "sajatfiok",
      name: "sajatfiok",
      role: "admin",
    } as never);
    vi.mocked(prisma.settings.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.channel.upsert).mockResolvedValue({} as never);
  });

  async function register(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/auth/route");
    return POST(
      createRequest("/api/auth", { method: "POST", body: { action: "register", ...body } })
    );
  }

  it("creates a second account with username and password alone", async () => {
    const response = await register({ username: "sajatfiok", password: "secure-password" });
    const data = await parseJsonResponse(response);
    expect(response.status).toBe(200);
    expect(data.user).not.toHaveProperty("password");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(prisma.admin.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: "sajatfiok", name: "sajatfiok", role: "admin" }),
    });
  });

  it("rejects a third account before creating an account", async () => {
    vi.mocked(prisma.admin.count).mockResolvedValue(2);
    const response = await register({ username: "other", password: "secure-password" });
    expect(response.status).toBe(409);
    expect(prisma.admin.create).not.toHaveBeenCalled();
  });

  it("handles a simultaneous signup losing the database singleton race", async () => {
    vi.mocked(prisma.admin.count).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    vi.mocked(prisma.admin.create).mockRejectedValueOnce({ code: "P2002" });
    const response = await register({ username: "other", password: "secure-password" });
    expect(response.status).toBe(409);
    expect((await parseJsonResponse(response)).code).toBe("ACCOUNT_LIMIT");
    expect(prisma.settings.upsert).not.toHaveBeenCalled();
  });

  it("keeps the bootstrap username reserved without closing the available slot", async () => {
    const response = await register({ username: "balazs", password: "secure-password" });
    expect(response.status).toBe(409);
    expect((await parseJsonResponse(response)).code).toBe("USERNAME_TAKEN");
    expect(prisma.admin.create).not.toHaveBeenCalled();
  });

  it.each([
    { username: 42, password: "secure-password" },
    { username: "bad name", password: "secure-password" },
    { username: "owner", password: "short" },
    { username: "owner", password: "é".repeat(40) },
  ])("rejects invalid credentials without writing a user: %j", async (body) => {
    expect((await register(body)).status).toBe(400);
    expect(prisma.admin.create).not.toHaveBeenCalled();
  });

  it("also blocks additional accounts through the admin API", async () => {
    const { POST } = await import("@/app/api/admin/users/route");
    const response = await POST(
      createRequest("/api/admin/users", {
        method: "POST",
        body: { username: "other", password: "secure-password" },
      })
    );
    expect(response.status).toBe(409);
    expect(prisma.admin.create).not.toHaveBeenCalled();
  });
});

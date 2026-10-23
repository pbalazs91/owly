import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";
import { generateGeminiContent } from "@/lib/ai/gemini";
import { GET, POST } from "@/app/api/conversations/test/route";
import { createRequest } from "../helpers/request";

vi.mock("@/lib/ai/gemini", () => ({ generateGeminiContent: vi.fn() }));
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const settings = { aiProvider: "gemini", aiModel: "test-model", aiApiKey: "not-a-real-key", businessName: "Acme", businessDesc: "Support", tone: "friendly", language: "auto", maxTokens: 100, temperature: 0.5 };
const send = (messages = [{ role: "user", content: "Mikor nyittok?" }]) => POST(createRequest("/api/conversations/test", { method: "POST", body: { messages } }));

beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs();
  vi.mocked(isAuthenticated).mockReturnValue(true);
  db.settings.findUnique.mockResolvedValue(settings);
  db.knowledgeEntry.findMany.mockResolvedValue([{ title: "Hours", content: "Hétfőn 9-kor nyitunk." }]);
  vi.mocked(generateGeminiContent).mockResolvedValue({ candidates: [{ content: { parts: [{ text: "Hétfőn 9-kor." }] } }] });
});

describe("isolated Conversations test chat", () => {
  it("requires authentication before reading settings or invoking AI", async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);
    vi.mocked(requireAuth).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await send()).status).toBe(401);
    expect(db.settings.findUnique).not.toHaveBeenCalled();
    expect(generateGeminiContent).not.toHaveBeenCalled();
  });
  it("returns only safe model metadata", async () => {
    const result = await GET(createRequest("/api/conversations/test"));
    expect(await result.json()).toEqual({ provider: "gemini", model: "test-model", configured: true });
  });
  it("uses the saved Gemini settings, knowledge and chat history without creating real records", async () => {
    const result = await send([{ role: "user", content: "Szia" }, { role: "assistant", content: "Szia!" }, { role: "user", content: "Mikor nyittok?" }]);
    expect(await result.json()).toMatchObject({ response: "Hétfőn 9-kor.", knowledgeEntries: 1, provider: "gemini" });
    expect(generateGeminiContent).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model", systemInstruction: expect.stringContaining("Hétfőn 9-kor nyitunk."), contents: [{ role: "user", parts: [{ text: "Szia" }] }, { role: "model", parts: [{ text: "Szia!" }] }, { role: "user", parts: [{ text: "Mikor nyittok?" }] }] }));
    expect(db.conversation.create).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.ticket.create).not.toHaveBeenCalled();
  });
  it("rejects malformed history and oversized messages", async () => {
    expect((await send([{ role: "assistant", content: "Start" }])).status).toBe(400);
    expect((await send([{ role: "user", content: "x".repeat(4001) }])).status).toBe(400);
    expect(generateGeminiContent).not.toHaveBeenCalled();
  });
  it("explains when a local Ollama is not reachable from the server", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "");
    db.settings.findUnique.mockResolvedValue({ ...settings, aiProvider: "ollama", aiApiKey: "" });
    const result = await send();
    expect(result.status).toBe(409);
    expect((await result.json()).error).toContain("saját gépeden");
    expect(generateGeminiContent).not.toHaveBeenCalled();
  });
  it("does not expose provider errors or credentials", async () => {
    vi.mocked(generateGeminiContent).mockRejectedValue(new Error("upstream error with not-a-real-key"));
    const result = await send();
    expect(result.status).toBe(502);
    expect(JSON.stringify(await result.json())).not.toContain("not-a-real-key");
  });
});

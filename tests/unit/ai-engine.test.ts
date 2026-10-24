import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

// Mock OpenAI
const mockOpenAICreateFn = vi.fn();
let mockOpenAIConfig: Record<string, unknown> | undefined;
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      constructor(config: Record<string, unknown>) { mockOpenAIConfig = config; }
      chat = {
        completions: {
          create: mockOpenAICreateFn,
        },
      };
    },
  };
});

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("AI Engine", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockOpenAICreateFn.mockReset();
    mockOpenAIConfig = undefined;

    // Default settings
    mockPrisma.settings.findFirst.mockResolvedValue({
      id: "default",
      businessName: "Test Biz",
      businessDesc: "A test business",
      welcomeMessage: "Hello!",
      tone: "friendly",
      language: "auto",
      aiProvider: "openai",
      aiModel: "gpt-4",
      aiApiKey: "sk-test",
      maxTokens: 1000,
      temperature: 0.7,
    });

    mockPrisma.settings.create.mockResolvedValue({
      id: "default",
      aiApiKey: "",
    });

    // Default knowledge base
    mockPrisma.knowledgeEntry.findMany.mockResolvedValue([]);

    // Default conversation
    mockPrisma.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      channel: "whatsapp",
      customerName: "John",
      customerContact: "+1555",
      status: "active",
      messages: [
        { role: "customer", content: "Hi", createdAt: new Date() },
      ],
    });

    // Default message creation
    mockPrisma.message.create.mockResolvedValue({ id: "msg-new" });
    mockPrisma.conversation.update.mockResolvedValue({});
  });

  it("should return fallback when AI API key is not configured", async () => {
    mockPrisma.settings.findFirst.mockResolvedValue({
      id: "default",
      aiApiKey: "",
      aiProvider: "openai",
      aiModel: "gpt-4",
      maxTokens: 1000,
      temperature: 0.7,
      businessName: "Test",
      businessDesc: "",
      welcomeMessage: "",
      tone: "friendly",
      language: "auto",
    });

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Hello");

    expect(response).toContain("AI is not configured");
  });

  it("should return error when conversation not found", async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("nonexistent", "Hello");

    expect(response).toBe("Conversation not found.");
  });

  it("should call OpenAI with correct parameters", async () => {
    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "Hello! How can I help?" },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "I need help");

    expect(response).toBe("Hello! How can I help?");
    expect(mockOpenAICreateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4",
        max_tokens: 1000,
        temperature: 0.7,
      })
    );
  });

  it("should use the local Ollama OpenAI-compatible endpoint without an API key", async () => {
    mockPrisma.settings.findFirst.mockResolvedValue({
      id: "default", aiProvider: "ollama", aiModel: "llama3.2:3b", aiApiKey: "",
      maxTokens: 1000, temperature: 0.7, businessName: "Test", businessDesc: "",
      welcomeMessage: "", tone: "friendly", language: "auto",
    });
    mockOpenAICreateFn.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: "Ollama reply" } }] });

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Hello");

    expect(response).toBe("Ollama reply");
    expect(mockOpenAIConfig).toEqual({ apiKey: "ollama", baseURL: "http://127.0.0.1:11434/v1" });
    expect(mockOpenAICreateFn).toHaveBeenCalledWith(expect.objectContaining({ model: "llama3.2:3b" }));
  });

  it("authenticates the remote Ollama OpenAI-compatible endpoint", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "https://example.com/ollama");
    vi.stubEnv("OLLAMA_API_KEY", "test-remote-secret");
    mockPrisma.settings.findFirst.mockResolvedValue({ id: "default", aiProvider: "ollama", aiModel: "qwen3:0.6b", aiApiKey: "", maxTokens: 100, temperature: 0.5, businessName: "Test", businessDesc: "", tone: "friendly", language: "auto" });
    mockOpenAICreateFn.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: "Szia!" } }] });
    const { chat } = await import("@/lib/ai/engine");
    expect(await chat("conv-1", "Hello")).toBe("Szia!");
    expect(mockOpenAIConfig).toEqual({ apiKey: "test-remote-secret", baseURL: "https://example.com/ollama/v1" });
  });

  it("should generate responses through Gemini with system instructions and tool declarations", async () => {
    mockPrisma.settings.findFirst.mockResolvedValue({
      id: "default", aiProvider: "gemini", aiModel: "gemini-3.8-flash", aiApiKey: "google-test-key",
      maxTokens: 1000, temperature: 0.4, businessName: "Test", businessDesc: "",
      welcomeMessage: "", tone: "friendly", language: "auto",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Gemini reply" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Hello");

    expect(response).toBe("Gemini reply");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "google-test-key" }),
        body: expect.stringContaining("function_declarations"),
      })
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.system_instruction.parts[0].text).toContain("Owly");
    expect(request.generation_config.max_output_tokens).toBe(1000);
  });

  it("should execute Gemini function calls and send results back before answering", async () => {
    mockPrisma.settings.findFirst.mockResolvedValue({
      id: "default", aiProvider: "gemini", aiModel: "gemini-3.8-flash", aiApiKey: "google-test-key",
      maxTokens: 1000, temperature: 0.4, businessName: "Test", businessDesc: "",
      welcomeMessage: "", tone: "friendly", language: "auto",
    });
    mockPrisma.conversation.findMany.mockResolvedValue([]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{
          functionCall: { id: "call-1", name: "get_customer_history", args: { customerContact: "+1555" } },
        }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "I found no previous chats." }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Do you know me?");

    expect(response).toBe("I found no previous chats.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const followup = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(followup.contents).toContainEqual(expect.objectContaining({
      role: "user",
      parts: [expect.objectContaining({ functionResponse: expect.objectContaining({
        id: "call-1", name: "get_customer_history",
      }) })],
    }));
  });

  it("should save user and assistant messages", async () => {
    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "I can help with that." },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "Help me");

    // User message saved
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv-1",
          role: "customer",
          content: "Help me",
        }),
      })
    );

    // Assistant message saved
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv-1",
          role: "assistant",
          content: "I can help with that.",
        }),
      })
    );
  });

  it("should include knowledge base in system prompt", async () => {
    mockPrisma.knowledgeEntry.findMany.mockResolvedValue([
      {
        category: { name: "FAQ" },
        title: "Return Policy",
        content: "30-day returns allowed",
        priority: 10,
      },
    ]);

    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "Our return policy..." },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "What is your return policy?");

    const callArgs = mockOpenAICreateFn.mock.calls[0][0];
    const systemMessage = callArgs.messages[0];
    expect(systemMessage.content).toContain("Return Policy");
    expect(systemMessage.content).toContain("30-day returns allowed");
  });

  it("should handle tool calls and recurse", async () => {
    // First call returns tool_calls
    mockOpenAICreateFn
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "get_customer_history",
                    arguments: JSON.stringify({ customerContact: "+1555" }),
                  },
                },
              ],
            },
          },
        ],
      })
      // Second call returns final response
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "Based on your history, I can see...",
            },
          },
        ],
      });

    // Mock the customer history tool
    mockPrisma.conversation.findMany.mockResolvedValue([]);

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Do you know me?");

    expect(response).toBe("Based on your history, I can see...");
    expect(mockOpenAICreateFn).toHaveBeenCalledTimes(2);
  });

  it("should return fallback message when content is empty", async () => {
    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "" },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Hello");

    expect(response).toContain("could not generate a response");
  });
});

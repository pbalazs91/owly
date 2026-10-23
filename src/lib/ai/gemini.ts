import type { ToolDefinition } from "./types";

type GeminiPart = {
  text?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};

export type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

export type GeminiResponse = {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

export async function generateGeminiContent(args: {
  apiKey: string;
  model: string;
  contents: GeminiContent[];
  systemInstruction?: string;
  maxTokens: number;
  temperature: number;
  tools?: ToolDefinition[];
}): Promise<GeminiResponse> {
  const model = args.model.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new Error("Invalid Gemini model name.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": args.apiKey,
        },
        body: JSON.stringify({
          contents: args.contents,
          ...(args.systemInstruction && {
            system_instruction: { parts: [{ text: args.systemInstruction }] },
          }),
          generation_config: {
            max_output_tokens: args.maxTokens,
            temperature: args.temperature,
          },
          ...(args.tools?.length && {
            tools: [{
              function_declarations: args.tools.map((tool) => ({
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters,
              })),
            }],
          }),
        }),
        signal: controller.signal,
      }
    );

    const body = await response.json().catch(() => null) as GeminiResponse | null;
    if (!response.ok) {
      const message = body?.error?.message || `Gemini request failed (${response.status}).`;
      throw new Error(message);
    }
    return body || {};
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini request timed out after 30 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

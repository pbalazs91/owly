import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, MAX_KNOWLEDGE_CHUNK_CHARS, splitKnowledgeContent } from "@/lib/knowledge-import-limits";

describe("knowledge document limits and splitting", () => {
  it("allows files larger than 10 MB up to 25 MB", () => {
    expect(MAX_IMPORT_BYTES).toBe(25 * 1024 * 1024);
  });

  it("splits long documents at readable boundaries without losing text", () => {
    const content = `${"Első bekezdés. ".repeat(500)}\n\n${"Második bekezdés. ".repeat(500)}`;
    const chunks = splitKnowledgeContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= MAX_KNOWLEDGE_CHUNK_CHARS)).toBe(true);
    expect(chunks.join("")).toBe(content);
  });

  it("keeps short content in one entry and handles long uninterrupted text", () => {
    expect(splitKnowledgeContent("rövid szöveg")).toEqual(["rövid szöveg"]);
    const content = "x".repeat(MAX_KNOWLEDGE_CHUNK_CHARS + 1);
    expect(splitKnowledgeContent(content)).toEqual(["x".repeat(MAX_KNOWLEDGE_CHUNK_CHARS), "x"]);
  });
});

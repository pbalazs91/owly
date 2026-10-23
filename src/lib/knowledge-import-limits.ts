export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_CHARS = 100000;
export const MAX_KNOWLEDGE_CHUNK_CHARS = 10000;
export const MAX_KNOWLEDGE_CHUNKS = 20;

/** Split text without dropping characters, preferring paragraph and line boundaries. */
export function splitKnowledgeContent(content: string, maxChars = MAX_KNOWLEDGE_CHUNK_CHARS): string[] {
  if (!content) return [];
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer");

  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + maxChars, content.length);
    if (end < content.length) {
      const minimum = start + Math.floor(maxChars * 0.7);
      const paragraph = content.lastIndexOf("\n\n", end - 1);
      const line = content.lastIndexOf("\n", end - 1);
      const space = content.lastIndexOf(" ", end - 1);
      if (paragraph >= minimum) end = paragraph + 2;
      else if (line >= minimum) end = line + 1;
      else if (space >= minimum) end = space + 1;
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

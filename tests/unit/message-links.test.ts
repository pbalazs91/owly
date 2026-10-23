import { describe, expect, it } from "vitest";
import { messageLinks } from "@/lib/message-links";

describe("message hyperlinks", () => {
  it("links plain web addresses while preserving punctuation and line breaks", () => {
    expect(messageLinks("Itt: https://example.com/test.\nwww.example.hu!" )).toEqual([{ text: "Itt: " }, { text: "https://example.com/test", href: "https://example.com/test" }, { text: "." }, { text: "\n" }, { text: "www.example.hu", href: "https://www.example.hu/" }, { text: "!" }]);
  });
  it("renders named Markdown links and balanced parentheses", () => {
    expect(messageLinks("[Honlap](https://example.hu) (https://example.hu/a_(b)).").filter(part => part.href)).toEqual([{ text: "Honlap", href: "https://example.hu/" }, { text: "https://example.hu/a_(b)", href: "https://example.hu/a_(b)" }]);
  });
  it("leaves dangerous schemes and credential-bearing URLs unlinked", () => {
    expect(messageLinks("[x](javascript:alert(1)) data:text/html,<script> https://user:password@example.com").some(part => part.href)).toBe(false);
  });
});

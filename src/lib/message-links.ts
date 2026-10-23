export type MessagePart = { text: string; href?: string };

function safeHref(value: string) {
  try {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function messageLinks(text: string): MessagePart[] {
  const pattern = /\[([^\]\r\n]+)\]\(((?:https?:\/\/|www\.)[^\s<>"']+?)\)|(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const parts: MessagePart[] = [];
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    if (start > position) parts.push({ text: text.slice(position, start) });
    let value = match[2] || match[0];
    if (!match[2]) {
      value = value.replace(/[.,!?;:*~]+$/, "");
      while (/[)\]}]$/.test(value)) {
        const closing = value.at(-1)!;
        const opening = closing === ")" ? "(" : closing === "]" ? "[" : "{";
        if (value.split(closing).length <= value.split(opening).length) break;
        value = value.slice(0, -1).replace(/[.,!?;:*~]+$/, "");
      }
    }
    const href = safeHref(value);
    if (href) {
      parts.push({ text: match[1] || value, href });
      if (!match[2] && value.length < match[0].length) parts.push({ text: match[0].slice(value.length) });
    } else parts.push({ text: match[0] });
    position = start + match[0].length;
  }
  if (position < text.length) parts.push({ text: text.slice(position) });
  return parts;
}

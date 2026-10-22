import { describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function bridge() {
  let incoming!: (message: any) => void;
  let action!: (event: any) => Promise<void>;
  const post = vi.fn();
  const me = "123@c.us";
  const message = (body: string, id: string, to = me) => ({ id: { _serialized: id, fromMe: true }, fromMe: true, from: me, to, t: Date.now() / 1000, type: "chat", body });
  const w: any = {
    WPP: { isReady: true, conn: { getMyUserWid: () => me, getMyUserId: () => me, getMyUserLid: () => "999@lid", isAuthenticated: () => true },
      on: (_: string, listener: typeof incoming) => { incoming = listener; },
      chat: { openChatBottom: vi.fn().mockResolvedValue(true), sendTextMessage: vi.fn(async (_: string, text: string) => { incoming(message(text, "sent-id")); }) } },
    postMessage: post, addEventListener: (_: string, listener: typeof action) => { action = listener; },
  };
  vm.runInNewContext(readFileSync("browser-extension/page-bridge.js", "utf8"), { window: w, location: { origin: "https://web.whatsapp.com" }, document: { querySelector: () => null }, setInterval: vi.fn(), Date, console });
  const command = (value: object) => action({ source: w, origin: "https://web.whatsapp.com", data: { channel: "owly-wa-content-v1", requestId: "test", ...value } });
  return { post, message, receive: (msg: any) => incoming(msg), command, w };
}
describe("WhatsApp self-chat testing", () => {
  it("accepts new user-written self messages but ignores outgoing messages to others", () => {
    const b = bridge();
    b.receive(b.message("Kérdés", "user-id"));
    expect(b.post.mock.calls.some(([value]) => value.type === "incoming" && value.message.content === "Kérdés")).toBe(true);
    b.post.mockClear();
    b.receive(b.message("Nem teszt", "other-id", "456@c.us"));
    expect(b.post).not.toHaveBeenCalled();
  });
  it("never treats its own AI reply or repeated delivery event as a new question", async () => {
    const b = bridge(); b.post.mockClear();
    await b.command({ action: "send", chatId: "123@c.us", content: "AI válasz" });
    b.receive(b.message("AI válasz", "sent-id"));
    expect(b.post.mock.calls.filter(([value]) => value.type === "incoming")).toEqual([]);
  });
  it("sends explicit test questions only to the logged-in user's self chat", async () => {
    const b = bridge();
    await b.command({ action: "test", chatId: "attacker@c.us", content: "Tesztkérdés" });
    expect(b.w.WPP.chat.sendTextMessage).toHaveBeenCalledWith("123@c.us", "Tesztkérdés");
    expect(b.post.mock.calls.some(([value]) => value.type === "incoming")).toBe(true);
  });
});

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function extension(initial = {}) {
  const stored: Record<string, unknown> = { ...initial };
  const send = vi.fn().mockResolvedValue({ sent: true });
  const fetch = vi.fn().mockImplementation(async (url: string, options?: { body?: string }) => ({
    ok: true, json: async () => url.includes('/api/chat') ? { message: { content: "Helyi válasz" } } :
      options?.body && JSON.parse(options.body).action === "canSend" ? { allowed: true } : {
      conversationId: "conv", messageId: "wab-id", aiEnabled: true, maxTokens: 128, temperature: .7,
      messages: [{ role: "user", content: "Kérdés" }],
    },
  }));
  const chrome = {
    runtime: { id: "extension-id", getURL: (path: string) => "chrome-extension://extension-id/" + path, onMessage: { addListener: vi.fn() } },
    storage: { local: { setAccessLevel: vi.fn(), get: async () => structuredClone(stored), set: async (value: object) => Object.assign(stored, structuredClone(value)) } },
    tabs: { get: async () => ({ id: 1, url: 'https://web.whatsapp.com/' }), query: vi.fn().mockResolvedValue([{ id: 1, windowId: 7 }]), update: vi.fn().mockResolvedValue({ id: 1, windowId: 7 }), reload: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue({ id: 2, windowId: 8 }), sendMessage: send, onRemoved: { addListener: vi.fn() } },
    windows: { update: vi.fn().mockResolvedValue({}) },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  };
  const context = vm.createContext({ chrome, fetch, AbortSignal, Date, console });
  vm.runInContext(readFileSync('browser-extension/background.js', 'utf8'), context);
  return { stored, send, fetch, chrome, handle: (message: object, sender: object) => context.handle(message, sender), incoming: (message: object) => context.incoming(message), heartbeat: () => context.heartbeat(), importHistory: (id: string) => context.importHistory(id) };
}
const popup = { id: "extension-id", url: "chrome-extension://extension-id/popup.html" };
const wa = { id: "extension-id", tab: { id: 1, url: "https://web.whatsapp.com/" } };
const incoming = { id: "one", chatId: "123@c.us", content: "Kérdés", name: "Ügyfél" };

describe("Chrome bridge permissions and delivery", () => {
  it("continues history import when one approved chat cannot be read", async () => {
    const app = extension({ token: "private-token", primaryTab: 1, waStatus: "connected", allowed: { '123@c.us': 'Unavailable', '456@c.us': 'Available' } });
    app.send.mockRejectedValueOnce(new Error('Chat unavailable')).mockResolvedValue({ messages: [] });
    await app.importHistory('job');
    expect(JSON.parse(app.fetch.mock.calls.at(-1)![1].body)).toMatchObject({ action: 'historyResult', status: 'done', chats: 1, skipped: 1, imported: 0 });
  });
  it("reports the source error when no approved chat can be read", async () => {
    const app = extension({ token: "private-token", primaryTab: 1, waStatus: "connected", allowed: { '123@c.us': 'Unavailable' } });
    app.send.mockRejectedValue(new Error('Chat unavailable'));
    await app.importHistory('job');
    const result = JSON.parse(app.fetch.mock.calls.at(-1)![1].body);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Chat unavailable');
    expect(result.chats).toBe(0);
  });
  it("imports qualified RocketSender replies even when AI processing is off, without generating or sending a reply", async () => {
    const app = extension({ token: "private-token", enabled: false, autoReply: true, rocket: { enabled: true, accountId: "+12025550100" } });
    app.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/check') ? { eligible: true } : { eventId: 'stored' } }));
    await app.incoming({ ...incoming, chatId: '12025550123@c.us', accountId: '12025550100@c.us', timestamp: Date.now(), fromMe: false });
    expect(app.fetch.mock.calls.map(([url]) => url)).toEqual(['https://owlyapp.onrender.com/api/integrations/rocketsender/check', 'https://owlyapp.onrender.com/api/integrations/rocketsender/inbound']);
    expect(app.send).not.toHaveBeenCalled();
    expect(app.stored.rocketPending).toEqual([]);
  });
  it("does not upload an unknown sender's message body", async () => {
    const app = extension({ token: "private-token", enabled: true, rocket: { enabled: true, accountId: "+12025550100" } });
    app.fetch.mockResolvedValue({ ok: true, json: async () => ({ eligible: false }) });
    await app.incoming({ ...incoming, chatId: '12025550123@c.us', accountId: '12025550100@c.us', timestamp: Date.now() });
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(app.fetch.mock.calls[0][1].body)).not.toHaveProperty('content');
    expect(app.stored.rocketPending).toEqual([]);
  });
  it("keeps a local reply pending when the server has not acknowledged storage", async () => {
    const app = extension({ token: "private-token", enabled: true, rocket: { enabled: true, accountId: "+12025550100" } });
    app.fetch.mockRejectedValue(new Error('Server unavailable'));
    await expect(app.incoming({ ...incoming, chatId: '12025550123@c.us', accountId: '12025550100@c.us', timestamp: Date.now() })).rejects.toThrow();
    expect(app.stored.rocketPending).toHaveLength(1);
  });
  it("imports only approved history without invoking AI or sending WhatsApp messages", async () => {
    const app = extension({ token: "private-token", primaryTab: 1, waStatus: "connected", allowed: { '123@c.us': 'Approved' }, remoteAllowed: { '456@c.us': 'Always approved' } });
    app.send.mockResolvedValue({ messages: [{ id: 'older', content: 'Old text', fromMe: false, timestamp: 1700000000000 }] });
    app.fetch.mockResolvedValue({ ok: true, json: async () => ({ imported: 1 }) });
    await app.importHistory('job');
    expect(app.send.mock.calls.map(([, message]) => message)).toEqual([
      { type: 'WA_HISTORY', chatId: '123@c.us' }, { type: 'WA_HISTORY', chatId: '456@c.us' },
    ]);
    expect(app.fetch.mock.calls.every(([url]) => !url.includes('/api/chat'))).toBe(true);
    expect(JSON.parse(app.fetch.mock.calls.at(-1)![1].body)).toMatchObject({ action: 'historyResult', status: 'done', imported: 2, chats: 2 });
  });
  it("automatically allows centrally configured numbers without per-chat approval", async () => {
    const app = extension({ token: "private-token", enabled: true, remoteAllowed: { '123@c.us': '+123' } });
    await app.incoming(incoming);
    expect(app.stored.drafts).toHaveLength(1);
    expect(app.stored.drafts[0].content).toBe('Helyi válasz');
  });
  it("stores server-generated Gemini replies without calling local Ollama", async () => {
    const app = extension({ token: "private-token", enabled: true, remoteAllowed: { '123@c.us': '+123' } });
    app.fetch.mockResolvedValue({ ok: true, json: async () => ({ conversationId: "conv", messageId: "wab-gemini", aiEnabled: true, generatedDraft: "Gemini válasz" }) });
    await app.incoming(incoming);
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch.mock.calls[0][0]).toContain("/api/channels/whatsapp/browser");
    expect(app.stored.drafts).toContainEqual(expect.objectContaining({ id: "wab-gemini", content: "Gemini válasz" }));
  });
  it("recovers the live WhatsApp tab from the content-script health check", async () => {
    const app = extension({ token: "private-token", primaryTab: 55 });
    app.send.mockRejectedValueOnce(new Error('old tab closed')).mockResolvedValue({ contentReady: true, status: 'connected', lastStatusAt: Date.now() });
    await app.heartbeat();
    expect(app.stored.primaryTab).toBe(1);
    expect(JSON.parse(app.fetch.mock.calls[0][1].body).status).toBe('connected');
  });
  it("reports a live WhatsApp connection even when processing is paused", async () => {
    const app = extension({ token: "private-token", enabled: false, waStatus: "connected", lastStatusAt: Date.now() });
    await app.heartbeat();
    expect(JSON.parse(app.fetch.mock.calls[0][1].body)).toMatchObject({ status: "connected", enabled: false, protocol: 2 });
  });
  it("schedules the Owly heartbeat every five minutes", () => {
    const app = extension();
    expect(app.chrome.alarms.create).toHaveBeenCalledWith('heartbeat', { periodInMinutes: 5 });
  });
  it("does not send repeated unchanged WhatsApp status reports", async () => {
    const app = extension({ token: "private-token", primaryTab: 1, waStatus: "connected", lastStatusAt: Date.now(), lastHeartbeatAt: Date.now() });
    await app.handle({ type: "WA_STATUS", status: "connected" }, wa);
    expect(app.fetch).not.toHaveBeenCalled();
  });
  it("reports WhatsApp state changes immediately", async () => {
    const app = extension({ token: "private-token", primaryTab: 1, waStatus: "loading", lastHeartbeatAt: Date.now() });
    await app.handle({ type: "WA_STATUS", status: "connected" }, wa);
    expect(app.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(app.fetch.mock.calls[0][1].body)).toMatchObject({ action: "heartbeat", status: "connected" });
  });
  it("applies and acknowledges remote processing changes", async () => {
    const app = extension({ token: "private-token", enabled: true });
    app.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ desiredEnabled: false, controlRevision: "revision1" }) });
    await app.heartbeat();
    expect(app.stored.enabled).toBe(false);
    expect(JSON.parse(app.fetch.mock.calls[1][1].body)).toMatchObject({ enabled: false, controlRevision: "revision1" });
  });
  it("brings an existing WhatsApp window forward and selects its tab", async () => {
    const app = extension();
    await app.handle({ type: "OPEN_WA" }, popup);
    expect(app.chrome.tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(app.chrome.tabs.reload).toHaveBeenCalledWith(1);
    expect(app.chrome.windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(app.stored.primaryTab).toBe(1);
  });
  it("opens and focuses a new WhatsApp tab when none exists", async () => {
    const app = extension();
    app.chrome.tabs.query.mockResolvedValue([]);
    await app.handle({ type: "OPEN_WA" }, popup);
    expect(app.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://web.whatsapp.com/', active: true });
    expect(app.chrome.windows.update).toHaveBeenCalledWith(8, { focused: true });
    expect(app.stored.primaryTab).toBe(2);
  });
  it("never exposes the stored pairing token to the popup state response", async () => {
    const app = extension({ token: "private-token" });
    const result = await app.handle({ type: "GET_STATE" }, popup);
    expect(result.token).toBe("saved"); expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it("does not let page content change configuration or send drafts", async () => {
    const app = extension({ primaryTab: 1 });
    expect(await app.handle({ type: "SAVE", token: "attacker", enabled: true }, wa)).toEqual({ ignored: true });
    expect(await app.handle({ type: "SEND_DRAFT", id: "x" }, wa)).toEqual({ ignored: true });
    expect(app.stored.token).toBeUndefined(); expect(app.send).not.toHaveBeenCalled();
  });
  it("ignores events from another tab even if WhatsApp is open there", async () => {
    const app = extension({ primaryTab: 2 });
    expect(await app.handle({ type: "WA_INCOMING", message: incoming }, wa)).toEqual({ ignored: true });
    expect(app.fetch).not.toHaveBeenCalled();
  });
  it("never imports messages from chats that have not been enabled", async () => {
    const app = extension({ enabled: true, token: "private-token" });
    await app.incoming(incoming); expect(app.fetch).not.toHaveBeenCalled();
  });
  it("creates a draft with local Ollama without automatically sending it", async () => {
    const app = extension({ enabled: true, token: "private-token", primaryTab: 1, allowed: { '123@c.us': 'Ügyfél' } });
    await app.incoming(incoming);
    expect(app.fetch.mock.calls[1][0]).toBe('http://127.0.0.1:11434/api/chat');
    expect(app.stored.drafts[0].content).toBe('Helyi válasz');
    expect(app.send).not.toHaveBeenCalled();
    await app.incoming(incoming); expect(app.fetch).toHaveBeenCalledTimes(3);
  });
  it("sends only on explicit approval and records delivery afterwards", async () => {
    const app = extension({ enabled: true, token: "private-token", primaryTab: 1, allowed: { '123@c.us': 'Ügyfél' }, drafts: [{ id: "draft1", chatId: "123@c.us", content: "Válasz" }] });
    await app.handle({ type: "SEND_DRAFT", id: "draft1" }, popup);
    expect(app.send).toHaveBeenCalledWith(1, { type: "WA_SEND", chatId: "123@c.us", content: "Válasz" });
    expect(JSON.parse(app.fetch.mock.calls[0][1].body).action).toBe('canSend');
    expect(JSON.parse(app.fetch.mock.calls[1][1].body).action).toBe('sent');
    expect(app.stored.drafts).toEqual([]);
  });
  it("does not resend an uncertain delivery or acknowledge it as sent", async () => {
    const app = extension({ enabled: true, token: "private-token", primaryTab: 1, allowed: { '123@c.us': 'Ügyfél' }, drafts: [{ id: "draft1", chatId: "123@c.us", content: "Válasz" }] });
    app.send.mockRejectedValue(new Error('timeout'));
    await expect(app.handle({ type: "SEND_DRAFT", id: "draft1" }, popup)).rejects.toThrow('timeout');
    expect(JSON.parse(app.fetch.mock.calls[0][1].body).action).toBe('canSend');
    await expect(app.handle({ type: "SEND_DRAFT", id: "draft1" }, popup)).rejects.toThrow();
    expect(app.send).toHaveBeenCalledOnce();
  });
  it("reports stale content-script heartbeats as disconnected", async () => {
    const app = extension({ token: "private-token", enabled: true, waStatus: 'connected', lastStatusAt: Date.now() - 70000 });
    await app.heartbeat(); expect(JSON.parse(app.fetch.mock.calls[0][1].body).status).toBe('disconnected');
  });
});

"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, Send, RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/modal";

type TestMessage = { role: "user" | "assistant"; content: string };

export function ConversationTestChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const [knowledgeEntries, setKnowledgeEntries] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/conversations/test", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error("A tesztbeállítások nem tölthetők be.");
      setProvider(`${result.provider} · ${result.model || "nincs modell"}`);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending, open]);
  useEffect(() => () => request.current?.abort(), []);

  function close() { request.current?.abort(); request.current = null; setPending(""); setOpen(false); }
  async function send() {
    const content = text.trim();
    if (!content || pending) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 50000);
    setPending(content); setError("");
    try {
      const response = await fetch("/api/conversations/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [...messages.slice(-18), { role: "user", content }] }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "A tesztválasz nem érkezett meg.");
      if (controller.signal.aborted) return;
      setMessages(current => [...current, { role: "user", content }, { role: "assistant", content: result.response }]);
      setText(""); setProvider(`${result.provider} · ${result.model}`); setKnowledgeEntries(result.knowledgeEntries);
    } catch (error) {
      if (request.current === controller) setError(controller.signal.aborted ? "A kérés megszakadt vagy lejárt. Újra próbálhatod." : error instanceof Error ? error.message : "A teszt nem sikerült.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setPending(""); }
    }
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-owly-primary px-4 py-2 text-sm font-medium text-white hover:bg-owly-primary-dark"><FlaskConical className="h-4 w-4" />Tesztbeszélgetés</button>
    <Modal open={open} onClose={close} title="AI tesztbeszélgetés" size="lg" className="mx-3 max-h-[95dvh] overflow-y-auto">
      <p className="text-sm text-owly-text-light">Próbáld ki az AI válaszait a mentett beállításokkal és az aktív tudásbázissal. A tesztüzenetek ebben az ablakban maradnak; WhatsApp-üzenetet nem küldünk.</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-owly-text-light"><span>{provider || "Beállítások betöltése…"}{knowledgeEntries !== null && ` · ${knowledgeEntries} tudásbázis-bejegyzés`}</span><button type="button" disabled={!!pending || messages.length === 0} onClick={() => { setMessages([]); setError(""); setKnowledgeEntries(null); }} className="inline-flex items-center gap-1 rounded-lg border border-owly-border px-2 py-1.5 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Új teszt</button></div>
      <div role="log" aria-label="Tesztbeszélgetés üzenetei" aria-live="polite" className="my-4 h-[min(40dvh,360px)] space-y-3 overflow-y-auto rounded-xl border border-owly-border bg-owly-bg p-4">
        {messages.length === 0 && !pending && <div className="py-6 text-center text-sm text-owly-text-light"><FlaskConical className="mx-auto mb-2 h-7 w-7" /><p>Írj egy kérdést úgy, mintha ügyfél lennél.</p><button type="button" onClick={() => setText("Szia! Miben tudtok segíteni?")} className="mt-3 rounded-lg border border-owly-border bg-owly-surface px-3 py-2 text-owly-text">Szia! Miben tudtok segíteni?</button></div>}
        {messages.map((message, index) => <div key={index} className={`max-w-[90%] rounded-xl px-4 py-3 ${message.role === "user" ? "ml-auto bg-owly-primary text-white" : "border border-owly-border bg-owly-surface text-owly-text"}`}><p className="mb-1 text-xs opacity-70">{message.role === "user" ? "Te, mint tesztügyfél" : "Owly AI"}</p><p className="whitespace-pre-wrap break-words text-sm">{message.content}</p></div>)}
        {pending && <><div className="ml-auto max-w-[90%] rounded-xl bg-owly-primary px-4 py-3 text-sm text-white whitespace-pre-wrap break-words">{pending}</div><p role="status" className="flex items-center gap-2 text-sm text-owly-text-light"><Loader2 className="h-4 w-4 animate-spin" />Owly válaszol…</p></>}
        <div ref={end} />
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <a href="/settings#ai" className="underline">AI-beállítások</a></p>}
      <form onSubmit={event => { event.preventDefault(); void send(); }} className="flex items-end gap-2">
        <textarea aria-label="Tesztüzenet" value={text} onChange={event => setText(event.target.value)} disabled={!!pending} maxLength={4000} rows={2} placeholder="Írd ide az ügyfél kérdését…" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} className="min-w-0 flex-1 resize-none rounded-lg border border-owly-border bg-owly-bg px-3 py-2 text-sm text-owly-text focus:outline-none focus:ring-2 focus:ring-owly-primary/30" />
        <button type="submit" disabled={!!pending || !text.trim()} className="inline-flex items-center gap-2 rounded-lg bg-owly-primary px-3 py-3 text-sm text-white disabled:opacity-50">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Teszt</button>
      </form>
      <p className="mt-2 text-xs text-owly-text-light">Enter: küldés · Shift+Enter: új sor · A szolgáltató szokásos API-keretét használja.</p>
    </Modal>
  </>;
}

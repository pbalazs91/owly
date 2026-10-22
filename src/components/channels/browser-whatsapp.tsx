"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function BrowserWhatsApp({ controlTarget }: { controlTarget?: HTMLDivElement | null }) {
  const [connection, setConnection] = useState({ paired: false, online: false, status: "disconnected", enabled: false, requestedEnabled: false, pending: false, supportsControl: false, alwaysAllowed: {} as Record<string, string> });
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/channels/whatsapp/browser", { cache: "no-store" });
    if (!response.ok) throw new Error("A bővítmény állapota nem kérdezhető le.");
    setConnection(await response.json());
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  const change = async (action: "pair" | "revoke") => {
    setBusy(true); setError(""); setCopyNotice("");
    try {
      const response = await fetch("/api/channels/whatsapp/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "A párosítás nem sikerült.");
      setToken(data.token || ""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Hiba történt."); }
    finally { setBusy(false); }
  };
  const copyCode = async () => {
    setError(""); setCopyNotice("");
    codeInput.current?.focus(); codeInput.current?.select();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
        setCopyNotice("Párosítókód kimásolva. Illeszd be a bővítménybe.");
        return;
      }
    } catch { /* Some embedded browsers block the Clipboard API. */ }
    try {
      codeInput.current?.focus(); codeInput.current?.select();
      if (document.execCommand("copy")) {
        setCopyNotice("Párosítókód kimásolva. Illeszd be a bővítménybe.");
        return;
      }
    } catch { /* Keyboard copying remains available. */ }
    setCopyNotice("A kód kijelölve. Nyomd meg a Ctrl+C billentyűket, majd a bővítményben a Ctrl+V-t.");
  };
  const setProcessing = async (enabled: boolean) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/channels/whatsapp/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "processing", enabled }) });
      if (!response.ok) throw new Error("A feldolgozás állapota nem állítható be.");
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Hiba történt."); }
    finally { setBusy(false); }
  };
  const labels: Record<string, string> = { connected: "WhatsApp csatlakoztatva", qr_ready: "A QR-kód a saját Chrome-odban vár beolvasásra", loading: "A WhatsApp Web töltődik", disconnected: "A bővítmény még nincs csatlakoztatva" };
  const savePhone = async (action: "allowPhone" | "removePhone", value = phone) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/channels/whatsapp/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, phone: value }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "A szám nem menthető.");
      setPhone(""); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Hiba történt."); }
    finally { setBusy(false); }
  };
  const controls = <div className="flex items-center gap-3">
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${connection.status === "connected" ? "bg-owly-success/10 text-owly-success" : "bg-owly-danger/10 text-owly-danger"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{connection.status === "connected" ? "Connected" : "Disconnected"}</span>
    <button type="button" role="switch" aria-label="WhatsApp üzenetfeldolgozás" title={connection.pending ? "Várakozás a bővítményre" : "WhatsApp üzenetfeldolgozás"} aria-checked={connection.pending ? connection.requestedEnabled : connection.enabled} disabled={busy || !connection.online || !connection.supportsControl || connection.pending} onClick={() => setProcessing(!connection.enabled)} className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${(connection.pending ? connection.requestedEnabled : connection.enabled) ? "bg-owly-primary" : "bg-owly-border"}`}><span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${(connection.pending ? connection.requestedEnabled : connection.enabled) ? "translate-x-5" : "translate-x-0"}`} /></button>
  </div>;
  return <div className="space-y-4 text-sm">
    {controlTarget ? createPortal(controls, controlTarget) : controls}
    <div className="flex items-center justify-between gap-3 rounded-lg border border-owly-border p-4">
      <div><p className="font-medium">WhatsApp üzenetfeldolgozás</p><p className="text-xs text-owly-text-light">{connection.pending ? "Várakozás a bővítmény visszajelzésére…" : !connection.online ? "A bővítmény nem érhető el" : !connection.supportsControl ? "Töltsd újra a frissített bővítményt" : connection.enabled ? "Bekapcsolva · a bővítmény visszaigazolta" : "Kikapcsolva · a WhatsApp ettől még csatlakozhat"}</p></div>
    </div>
    <div role="status" className="rounded-lg bg-owly-bg border border-owly-border p-4">{labels[connection.status] || labels.disconnected}</div>
    <p>A WhatsApp Web és az Ollama a saját gépeden fut. A QR-kód a Chrome-ban megnyitott WhatsApp-oldalon jelenik meg; itt nem kell szerveres böngészőt indítani.</p>
    <div className="rounded-lg border border-owly-border p-3 space-y-2">
      <p className="font-medium">Mindig engedélyezett telefonszámok</p>
      <p className="text-xs text-owly-text-light">Ezeket a beszélgetéseket nem kell külön engedélyezni a bővítményben. A feldolgozás főkapcsolója rájuk is érvényes.</p>
      {Object.entries(connection.alwaysAllowed).map(([id, value]) => <div key={id} className="flex items-center justify-between gap-2"><span>{value}</span><button type="button" disabled={busy} onClick={() => savePhone("removePhone", value)} className="text-xs underline">Eltávolítás</button></div>)}
      <label className="block">Telefonszám<input aria-label="Mindig engedélyezett telefonszám" type="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+36…" className="mt-1 w-full rounded-lg border border-owly-border p-2 bg-owly-bg" /></label>
      <button type="button" disabled={busy || !phone.trim()} onClick={() => savePhone("allowPhone")} className="rounded-lg border border-owly-border px-3 py-2">Szám mindig engedélyezése</button>
    </div>
    <ol className="list-decimal pl-5 space-y-2">
      <li><a className="text-owly-primary underline" href="/owly-chrome.zip" download>Töltsd le az Owly Chrome-bővítményt</a>, és csomagold ki. A Chrome Bővítmények oldalán kapcsold be a Fejlesztői módot, majd a Kicsomagolt bővítmény betöltése gombbal válaszd ki a mappát.</li>
      <li>Hozz létre párosítókódot itt, majd másold a bővítmény Owly párosítókód mezőjébe.</li>
      <li>A bővítmény WhatsApp Web megnyitása gombjával nyisd meg a WhatsAppot. A telefonodon: Kapcsolt eszközök → Eszköz kapcsolása → a QR-kód beolvasása.</li>
      <li>Kapcsold be a feldolgozást, és külön engedélyezd a kezelendő beszélgetéseket. A választervezetek a bővítményben jelennek meg; az automatikus küldés külön kapcsolóval indítható.</li>
    </ol>
    <p className="text-owly-text-light">A géped és a WhatsApp-lap maradjon nyitva. A párosítókód 30 napig érvényes. Új kód létrehozása a korábbit érvényteleníti.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => change("pair")} className="rounded-lg bg-owly-primary px-4 py-2 text-white disabled:opacity-50">Párosítókód létrehozása</button>
      {connection.paired && <button type="button" disabled={busy} onClick={() => change("revoke")} className="rounded-lg border border-owly-border px-4 py-2">Bővítmény hozzáférésének visszavonása</button>}
    </div>
    {token && <div className="space-y-2">
      <label className="block">Párosítókód – csak a saját Owly-bővítményedbe másold:
        <input ref={codeInput} aria-label="Owly párosítókód" readOnly type="text" value={token} autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} className="mt-1 w-full rounded-lg border border-owly-border bg-owly-bg p-2 font-mono text-xs" />
      </label>
      <button type="button" onClick={copyCode} className="rounded-lg border border-owly-border px-3 py-2">Párosítókód másolása</button>
      {copyNotice && <p role="status" className="text-owly-primary">{copyNotice}</p>}
    </div>}
    {error && <p role="alert" className="text-owly-danger">{error}</p>}
  </div>;
}

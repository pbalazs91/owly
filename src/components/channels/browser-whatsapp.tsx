"use client";
import { useCallback, useEffect, useState } from "react";

export function BrowserWhatsApp() {
  const [connection, setConnection] = useState({ paired: false, online: false, status: "disconnected" });
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/channels/whatsapp/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "A párosítás nem sikerült.");
      setToken(data.token || ""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Hiba történt."); }
    finally { setBusy(false); }
  };
  const labels: Record<string, string> = { connected: "WhatsApp csatlakoztatva", qr_ready: "A QR-kód a saját Chrome-odban vár beolvasásra", loading: "A WhatsApp Web töltődik", disconnected: "A bővítmény még nincs csatlakoztatva" };
  return <div className="space-y-4 text-sm">
    <div role="status" className="rounded-lg bg-owly-bg border border-owly-border p-4">{labels[connection.status] || labels.disconnected}</div>
    <p>A WhatsApp Web és az Ollama a saját gépeden fut. A QR-kód a Chrome-ban megnyitott WhatsApp-oldalon jelenik meg; itt nem kell szerveres böngészőt indítani.</p>
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
        <input aria-label="Owly párosítókód" readOnly type="password" value={token} className="mt-1 w-full rounded-lg border border-owly-border bg-owly-bg p-2" />
      </label>
      <button type="button" onClick={() => navigator.clipboard.writeText(token).catch(() => setError("A kódot kézzel is kijelölheted és másolhatod."))} className="rounded-lg border border-owly-border px-3 py-2">Párosítókód másolása</button>
    </div>}
    {error && <p role="alert" className="text-owly-danger">{error}</p>}
  </div>;
}

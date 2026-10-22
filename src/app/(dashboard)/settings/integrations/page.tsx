"use client";
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { parseRegistryFile } from "@/lib/rocketsender/registry-file";

type Settings = { mode: string; accountId: string; trialPhone: string; compatibilityVerified: boolean };
type Event = { id: string; status: string; attempts: number; lastErrorCode: string; createdAt: string; customerId?: string; conversationId?: string };
type State = { settings: Settings; events: Event[]; dead: number; pending: number; sent: number };
const field = "block mt-1 w-full rounded-lg border border-owly-border bg-owly-bg px-3 py-2";
const button = "rounded-lg border border-owly-border px-4 py-2 disabled:opacity-50";

export default function IntegrationsPage() {
  const [data, setData] = useState<State | null>(null);
  const [form, setForm] = useState<Settings>({ mode: "disabled", accountId: "", trialPhone: "", compatibilityVerified: false });
  const [campaign, setCampaign] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function refresh(initialize = false) {
    const response = await fetch("/api/integrations/rocketsender", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Az integráció nem kérdezhető le.");
    setData(value); if (initialize) setForm(value.settings);
  }
  useEffect(() => {
    refresh(true).catch(error => setError(error.message));
    const timer = setInterval(() => refresh().catch(error => setError(error.message)), 15000);
    return () => clearInterval(timer);
  }, []);
  async function submit(body: unknown, path = "", message = "Mentve.") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/rocketsender" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "A művelet nem sikerült.");
      await refresh(); setNotice(message);
    } catch (error) { setError(error instanceof Error ? error.message : "Hiba történt."); }
    finally { setBusy(false); }
  }
  return <>
    <Header title="Integrations" description="Külső rendszerek és importok" />
    <div className="overflow-auto p-6 space-y-5 max-w-5xl">
      <section className="rounded-xl border border-owly-border bg-owly-surface p-5 space-y-4">
        <div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">RocketSender</h2><span>{data?.settings.compatibilityVerified ? "Próba ellenőrizve" : "A valódi kapcsolat még nincs igazolva"}</span></div>
        <p>Csak korábban nyilvántartott megkeresésre érkező ügyfélválasz hoz létre vagy frissít ügyfelet. A kiküldés, kézbesítés és elolvasás nem indít importot.</p>
        <label className="block">Saját WhatsApp-fiók telefonszáma<input className={field} type="tel" value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })} placeholder="+36…" /></label>
        <label className="block">Külön teszttelefon száma<input className={field} type="tel" value={form.trialPhone} onChange={e => setForm({ ...form, trialPhone: e.target.value })} placeholder="+36…" /></label>
        <label className="block">Import módja<select className={field} value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}><option value="disabled">Kikapcsolva</option><option value="trial">Próba – csak a tesztszám válaszai</option><option value="active" disabled={!data?.settings.compatibilityVerified}>Bekapcsolva – nyilvántartott megkeresések válaszai</option></select></label>
        <p><input type="checkbox" checked disabled readOnly /> Duplikációvédelem mindig bekapcsolva</p>
        <p><input type="checkbox" checked={false} disabled readOnly /> AI-válaszjavaslat – ebben az első verzióban nincs bekapcsolva</p>
        <p><input type="checkbox" checked={false} disabled readOnly /> Automatikus WhatsApp-üzenetküldés – letiltva</p>
        <button className={button} disabled={busy} onClick={() => submit({ action: "configure", ...form })}>Beállítások mentése</button>
      </section>
      <section className="rounded-xl border border-owly-border bg-owly-surface p-5 space-y-3">
        <h3 className="font-semibold">Tényleges küldések nyilvántartása</h3>
        <p>A RocketSender jelenleg nem igazolt webhookforrás. A sikeres küldések eredményét a sablon szerinti CSV/JSON-fájlból rögzítheted. Ez még nem hoz létre Owly-ügyfelet. Egy címzettlista vagy a tervezett küldési idő nem elegendő.</p>
        <p>Az Excel-eredményt előbb mentsd CSV-ként, és igazítsd a sablonhoz. Csak a <code>sent</code> állapotú sorok fogadhatók el. A tényleges időpontot nem pótoljuk a feltöltés időpontjával.</p>
        <a className="underline" href="/rocketsender-sent-template.csv" download>Küldési sablon letöltése</a>
        <label className="block">Kampányazonosító<input className={field} value={campaign} onChange={e => setCampaign(e.target.value)} /></label>
        <label className="block">Sikeres küldési napló feltöltése<input className={field} type="file" accept=".csv,.json,text/csv,application/json" disabled={busy || !form.accountId || !campaign.trim()} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          if (file.size > 128000) { setError("Legfeljebb 128 kB-os fájl tölthető fel."); return; }
          try { await submit(parseRegistryFile(await file.text(), form.accountId, campaign), "/outbound", "Küldési napló rögzítve. Ügyfél még nem jött létre."); }
          catch (error) { setError(error instanceof Error ? error.message : "A fájl nem olvasható."); }
        }} /></label>
        <p>{data?.sent || 0} küldés nyilvántartva · {data?.pending || 0} feldolgozásra váró esemény</p>
      </section>
      <section className="rounded-xl border border-owly-border bg-owly-surface p-5 space-y-3">
        <h3 className="font-semibold">Kapcsolati próba</h3>
        <ol className="list-decimal pl-5 space-y-2"><li>Mentsd el a saját WhatsApp-fiók és egy másik teszttelefon számát, próba módban.</li><li>A RocketSenderrel küldj egy üzenetet a teszttelefonra. Rögzítsd a sikeres küldést a fenti naplóban.</li><li>A másik telefonról válaszolj. Ellenőrizd a Customers és Conversations oldalakon az új profilt és az eredeti időpontokat.</li><li>Az alábbi ellenőrzés újrafeldolgozza ugyanazt az eseményazonosítót; ez nem küld üzenetet.</li></ol>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> A próbát valóban RocketSenderrel végeztem, és az importált választ ellenőriztem.</label>
        <button className={button} disabled={busy || !confirmed} onClick={() => submit({ action: "verify", confirmed }, "", "A tesztválasz és a duplikációpróba ellenőrizve. Az aktív mód külön menthető.")}>Duplikációpróba és kapcsolat ellenőrzése</button>
      </section>
      {data && data.dead > 0 && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{data.dead} import tartós hibával leállt. Javítás után az importnaplóban újraindítható.</p>}
      <section className="rounded-xl border border-owly-border bg-owly-surface p-5 space-y-3">
        <h3 className="font-semibold">Importnapló</h3>
        <button className={button} disabled={busy} onClick={() => submit({ action: "drain" }, "", "Az esedékes importok feldolgozása megtörtént.")}>Várakozó események feldolgozása</button>
        <p>A függő események az adatbázisban megmaradnak. A nyitott Chrome-bővítmény rendszeresen újrapróbálja őket; bezárt böngésző vagy alvó ingyenes Render esetén a folytatás a következő eléréskor történik.</p>
        {!data?.events.length && <p>Még nincs importesemény.</p>}
        {data?.events.map(event => <div key={event.id} className="border-t border-owly-border py-3 text-sm"><p>{new Date(event.createdAt).toLocaleString("hu-HU")} · {event.status} · {event.attempts} újrapróbálkozás</p>{event.lastErrorCode && <p>{event.lastErrorCode}</p>}{event.customerId && <a className="underline mr-3" href="/customers">Ügyfél megtekintése</a>}{event.conversationId && <a className="underline mr-3" href="/conversations">Beszélgetés megtekintése</a>}{event.status === "dead" && <button className={button} disabled={busy} onClick={() => submit({ action: "retry", eventId: event.id })}>Újrapróbálás</button>}</div>)}
      </section>
      {notice && <p role="status" className="text-green-700">{notice}</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  </>;
}

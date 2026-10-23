"use client";
import { useState } from "react";

export function CompanyNameLookup({ customerId, onAccepted }: { customerId: string; onAccepted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [candidates, setCandidates] = useState<{ name: string; sourceUrl: string; token: string }[]>([]);
  async function action(body: object) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/customers/${customerId}/company-name`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "A keresés nem sikerült.");
      if (data.ok) { setCandidates([]); setNotice("A cégnév és a forrás mentve."); onAccepted(); }
      else { setCandidates(data.candidates); if (!data.candidates.length) setNotice("Nem találtunk telefonszámmal egyező nyilvános céges adatot. Ez az adatforrás nem fed le minden céget."); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Hiba történt."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 text-sm">
    <p className="font-medium">Nyilvános céges névjavaslat</p>
    <p className="text-xs text-owly-text-light">A gomb a telefonszámot a Wikidata nyilvános céges adatbázisában keresi. Csak pontos számegyezésből készül javaslat, forrással; a meglévő nevet a jóváhagyásod után írjuk át. Magánszemélyekre nem keresünk.</p>
    <button disabled={busy} type="button" className="rounded-lg border border-owly-border px-3 py-2 disabled:opacity-50" onClick={() => action({ action: "lookup" })}>{busy ? "Folyamatban…" : "Céges név keresése"}</button>
    {candidates.map(candidate => <div key={candidate.sourceUrl} className="rounded-lg border border-owly-border p-3"><p>{candidate.name}</p><a className="underline mr-3" target="_blank" rel="noopener noreferrer" href={candidate.sourceUrl}>Nyilvános forrás</a><button disabled={busy} className="underline" onClick={() => action({ action: "accept", token: candidate.token })}>Név jóváhagyása és mentése</button></div>)}
    {notice && <p role="status">{notice}</p>}
  </div>;
}

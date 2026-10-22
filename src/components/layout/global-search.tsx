"use client";
import { useEffect, useRef, useState } from "react";

export function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<{ id: string; kind: string; title: string; detail: string; href: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setItems([]); setError(""); setBusy(false);
    if (query.trim().length < 2) return () => controller.abort();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/search?q=" + encodeURIComponent(query.trim()), { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "A keresés nem sikerült.");
        if (!controller.signal.aborted) setItems(data.items);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Hiba történt."); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Keresés" className="w-full max-w-2xl rounded-xl border border-owly-border bg-owly-surface p-5 shadow-xl" onKeyDown={e => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>('input,button,a[href]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Keresés</h3><button onClick={onClose} aria-label="Keresés bezárása" className="px-2 py-1">Bezárás</button></div>
      <input autoFocus aria-label="Globális keresés" type="search" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} placeholder="Ügyfél, telefonszám vagy jegy…" className="w-full rounded-lg border border-owly-border bg-owly-bg px-3 py-2" />
      <div className="mt-3 max-h-[50vh] overflow-auto space-y-2">
        {query.trim().length < 2 ? <p className="text-sm text-owly-text-light">Írj be legalább 2 karaktert.</p> : busy ? <p role="status">Keresés…</p> : !error && !items.length ? <p role="status">Nincs találat.</p> : null}
        {error && <p role="alert" className="text-red-600">{error}</p>}
        {items.map(item => <a key={item.id} href={item.href} className="block rounded-lg border border-owly-border p-3 hover:bg-owly-primary-50"><span className="text-xs text-owly-text-light">{item.kind}</span><p className="font-medium">{item.title}</p><p className="text-sm text-owly-text-light">{item.detail}</p></a>)}
      </div>
    </div>
  </div>;
}

"use client";
import { useRef, useState } from "react";
import { MAX_IMPORT_BYTES } from "@/lib/knowledge-import-limits";

export function KnowledgeFileImport({ onImported }: { onImported: (value: { title: string; content: string }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (file.size > MAX_IMPORT_BYTES) { setError("A fájl legfeljebb 25 MB lehet."); return; }
    setBusy(true);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/knowledge/import", { method: "POST", body: form });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "A fájl nem olvasható.");
      onImported(value);
    } catch (error) { setError(error instanceof Error ? error.message : "A feltöltés nem sikerült."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <div className="rounded-lg border border-owly-border p-3 space-y-2">
    <input ref={input} aria-label="Tudásbázis-fájl kiválasztása" type="file" accept=".pdf,.txt,.md,.csv" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} className="text-sm max-w-full" />
    <p className="text-xs text-owly-text-light">PDF, TXT, Markdown, CSV · legfeljebb 25 MB, PDF-nél 250 oldal. Legfeljebb 100 000 karakter nyerhető ki; lent ellenőrizheted és szerkesztheted, mentéskor pedig 10 000 karakteres részekre bontjuk. Az eredeti fájlt nem tároljuk.</p>
    {busy && <p role="status" className="text-sm">Fájl beolvasása…</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}

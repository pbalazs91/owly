"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, BookOpen, Check, CheckCircle2, CircleDashed, Copy, KeyRound, MessageCircle, Send, Users, type LucideIcon } from "lucide-react";
import { Header } from "@/components/layout/header";
import { parseRegistryFile } from "@/lib/rocketsender/registry-file";
import { parseRocketContactFile } from "@/lib/rocketsender/contact-file";

type Settings = { mode: string; accountId: string; trialPhone: string; compatibilityVerified: boolean; aiSuggestions: boolean };
type Event = { id: string; status: string; attempts: number; lastErrorCode: string; createdAt: string; customerId?: string; conversationId?: string };
type State = { settings: Settings; events: Event[]; dead: number; pending: number; sent: number };
type ProviderState = {
  fallbackEnabled: boolean;
  fallbackProvider: "infobip" | "peach";
  infobip: { baseUrl: string; sender: string; hasApiKey: boolean; hasWebhookToken: boolean };
  peach: { flowId: string; hasApiKey: boolean; hasWebhookToken: boolean };
};
type FallbackEvent = { id: string; customerContact: string; fallbackProvider: string; status: string; dueAt: string; createdAt: string; lastErrorCode: string };
type ProviderForm = {
  fallbackEnabled: boolean;
  fallbackProvider: "infobip" | "peach";
  infobip: { baseUrl: string; sender: string; apiKey: string; webhookToken: string };
  peach: { flowId: string; apiKey: string; webhookToken: string };
};
type NotionSettings = { databaseId: string; enabled: boolean; hasToken: boolean; lastSyncAt: string | null; lastSyncError: string; syncOffset: number };
type NotionActionResponse = { error?: string; settings?: NotionSettings; message?: string; created?: number; updated?: number; failed?: number; errors?: string[]; hasMore?: boolean; nextOffset?: number };
type AiStudioState = { backendUrl: string; healthUrl: string; enabled: boolean; hasSecret: boolean; secretHint: string; lastUsedAt: string | null; whatsapp: { connected: boolean; status: string; processingEnabled: boolean; lastSeenAt: string | null } };
const field = "mt-1 block w-full rounded-lg border border-owly-border bg-owly-bg px-3 py-2.5 text-sm text-owly-text placeholder:text-owly-text-light/70 transition-colors focus:border-owly-primary focus:outline-none focus:ring-2 focus:ring-owly-primary/20";
const button = "inline-flex min-h-10 items-center justify-center rounded-lg border border-owly-border bg-owly-surface px-4 py-2 text-sm font-medium text-owly-text transition-colors hover:border-owly-primary/40 hover:bg-owly-primary-50 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "inline-flex min-h-10 items-center justify-center rounded-lg bg-owly-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-owly-primary-dark disabled:cursor-not-allowed disabled:opacity-50";

function IntegrationCard({ id, title, description, status, active = false, icon: Icon, children }: {
  id: string;
  title: string;
  description: string;
  status?: string;
  active?: boolean;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return <section id={id} className="scroll-mt-6 overflow-hidden rounded-xl border border-owly-border bg-owly-surface shadow-sm transition-theme">
    <div className="flex flex-col gap-4 border-b border-owly-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-owly-primary-50 text-owly-primary"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0"><h2 className="text-base font-semibold text-owly-text sm:text-lg">{title}</h2><p className="mt-0.5 text-sm text-owly-text-light">{description}</p></div>
      </div>
      {status && <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-owly-bg text-owly-text-light"}`}>
        {active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}{status}
      </span>}
    </div>
    <div className="space-y-5 p-5 sm:p-6">{children}</div>
  </section>;
}
const emptyProviderForm: ProviderForm = {
  fallbackEnabled: false,
  fallbackProvider: "infobip",
  infobip: { baseUrl: "", sender: "", apiKey: "", webhookToken: "" },
  peach: { flowId: "", apiKey: "", webhookToken: "" },
};

export default function IntegrationsPage() {
  const [data, setData] = useState<State | null>(null);
  const [form, setForm] = useState<Settings>({ mode: "disabled", accountId: "", trialPhone: "", compatibilityVerified: false, aiSuggestions: false });
  const [campaign, setCampaign] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm);
  const [providerState, setProviderState] = useState<ProviderState | null>(null);
  const [providerWebhooks, setProviderWebhooks] = useState<{ infobip: string; peach: string } | null>(null);
  const [fallbackEvents, setFallbackEvents] = useState<FallbackEvent[]>([]);
  const [notionSettings, setNotionSettings] = useState<NotionSettings | null>(null);
  const [notionForm, setNotionForm] = useState({ token: "", databaseId: "", enabled: false });
  const [aiStudio, setAiStudio] = useState<AiStudioState | null>(null);
  const [aiStudioSecret, setAiStudioSecret] = useState("");
  const [copiedAiStudio, setCopiedAiStudio] = useState(false);
  async function refresh(initialize = false) {
    const response = await fetch("/api/integrations/rocketsender", { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Az integráció nem kérdezhető le.");
    setData(value); if (initialize) setForm(value.settings);
  }
  useEffect(() => {
    refresh(true).catch(error => setError(error.message));
    fetch("/api/integrations/notion", { cache: "no-store" }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "A Notion-beállítások nem tölthetők be.");
      setNotionSettings(value.settings);
      setNotionForm({ token: "", databaseId: value.settings.databaseId, enabled: value.settings.enabled });
    }).catch(error => setError(error.message));
    fetch("/api/integrations/ai-studio", { cache: "no-store" }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message || value.error || "Az AI Studio-kapcsolat nem tölthető be.");
      setAiStudio(value);
    }).catch(error => setError(error.message));
    fetch("/api/integrations/whatsapp/providers", { cache: "no-store" }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "A WhatsApp-szolgáltatók nem tölthetők be.");
      setProviderState(value.settings);
      setProviderWebhooks(value.webhooks);
      setFallbackEvents(value.fallbacks || []);
      setProviderForm({
        ...emptyProviderForm,
        fallbackEnabled: value.settings.fallbackEnabled,
        fallbackProvider: value.settings.fallbackProvider,
        infobip: { ...emptyProviderForm.infobip, baseUrl: value.settings.infobip.baseUrl, sender: value.settings.infobip.sender },
        peach: { ...emptyProviderForm.peach, flowId: value.settings.peach.flowId },
      });
    }).catch(error => setError(error.message));
    const timer = setInterval(() => refresh().catch(error => setError(error.message)), 15000);
    const providerTimer = setInterval(() => {
      fetch("/api/integrations/whatsapp/providers", { cache: "no-store" }).then(response => response.json()).then(value => {
        if (Array.isArray(value.fallbacks)) setFallbackEvents(value.fallbacks);
      }).catch(() => {});
    }, 15000);
    return () => { clearInterval(timer); clearInterval(providerTimer); };
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
  async function importRocketContacts(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (file.size > 128000) throw new Error("A fájl legfeljebb 128 kB lehet.");
      const contacts = parseRocketContactFile(await file.text());
      const response = await fetch("/api/integrations/rocketsender/contacts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "A kontaktimport nem sikerült.");
      setNotice(`${result.imported} kontakt importálva: ${result.created} új, ${result.updated} frissítve, ${result.duplicates} ismétlődő sor kihagyva. Az „active” címke csak válasz után kerül rá.`);
    } catch (error) { setError(error instanceof Error ? error.message : "A CSV-fájl nem olvasható."); }
    finally { setBusy(false); }
  }
  async function saveProviders() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/whatsapp/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "A szolgáltatói beállítások mentése sikertelen.");
      setProviderState(result.settings);
      setProviderForm(current => ({ ...current, infobip: { ...current.infobip, apiKey: "", webhookToken: "" }, peach: { ...current.peach, apiKey: "", webhookToken: "" } }));
      setNotice("A WhatsApp-szolgáltatók beállításai elmentve.");
    } catch (error) { setError(error instanceof Error ? error.message : "Hiba történt."); }
    finally { setBusy(false); }
  }
  async function notionAction(action: "save" | "test" | "sync") {
    setBusy(true); setError(""); setNotice("");
    try {
      let result: NotionActionResponse = {};
      const summary = { created: 0, updated: 0, failed: 0 };
      let hasMore = false;
      for (let batch = 0; batch < (action === "sync" ? 10 : 1); batch += 1) {
        const response = await fetch("/api/integrations/notion", {
          method: action === "save" ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "save" ? notionForm : { action }),
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || "A Notion-művelet nem sikerült.");
        if (action !== "sync") break;
        if ((result.failed ?? 0) > 0) throw new Error(result.errors?.join(" | ") || "Néhány rekord szinkronja nem sikerült. Próbáld újra.");
        summary.created += result.created ?? 0;
        summary.updated += result.updated ?? 0;
        summary.failed += result.failed ?? 0;
        hasMore = result.hasMore === true;
        if (!hasMore) break;
      }
      const savedSettings = result.settings;
      if (savedSettings) {
        setNotionSettings(savedSettings);
        setNotionForm(current => ({ ...current, token: "", databaseId: savedSettings.databaseId, enabled: savedSettings.enabled }));
      } else if (action === "sync") {
        setNotionSettings(current => current ? { ...current, lastSyncAt: new Date().toISOString(), lastSyncError: result.errors?.join(" | ") || "", syncOffset: result.nextOffset || 0 } : current);
      }
      setNotice(action === "save" ? "A Notion-beállítások mentve." : action === "test" ? result.message || "A Notion-kapcsolat ellenőrizve." : `Notion-szinkron: ${summary.created} új, ${summary.updated} frissített rekord.${hasMore ? " További rekordok vannak; a következő indítás folytatja." : " Minden rekord feldolgozva."}`);
    } catch (error) { setError(error instanceof Error ? error.message : "A Notion-művelet nem sikerült."); }
    finally { setBusy(false); }
  }
  async function rotateAiStudioSecret() {
    if (aiStudio?.hasSecret && !window.confirm("A régi kulcs azonnal érvényét veszti. Az új kulcsot az AI Studio Cloud Run környezeti változójában is cseréld le. Folytatod?")) return;
    setBusy(true); setError(""); setNotice(""); setCopiedAiStudio(false);
    try {
      const response = await fetch("/api/integrations/ai-studio", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rotate_secret" }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message || value.error || "A kulcs létrehozása nem sikerült.");
      const { secret: generatedSecret, ...safeValue } = value;
      setAiStudio(current => current ? { ...current, ...safeValue } : current);
      setAiStudioSecret(generatedSecret);
      setNotice("Az új kulcs elkészült. Másold át most az AI Studio Cloud Run OWLY_BACKEND_SECRET mezőjébe.");
    } catch (error) { setError(error instanceof Error ? error.message : "A kulcs létrehozása nem sikerült."); }
    finally { setBusy(false); }
  }
  async function revokeAiStudioSecret() {
    if (!window.confirm("Visszavonod az AI Studio kulcsot? A Cloud Run alkalmazás utána nem fér hozzá az Owly állapotához.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/ai-studio", { method: "DELETE" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message || value.error || "A kulcs visszavonása nem sikerült.");
      setAiStudio(current => current ? { ...current, enabled: false, hasSecret: false, secretHint: "", lastUsedAt: null } : current);
      setAiStudioSecret("");
      setNotice("Az AI Studio-kulcs visszavonva.");
    } catch (error) { setError(error instanceof Error ? error.message : "A kulcs visszavonása nem sikerült."); }
    finally { setBusy(false); }
  }
  async function copyAiStudioEnvironment() {
    if (!aiStudio || !aiStudioSecret) return;
    try {
      await navigator.clipboard.writeText(`OWLY_BACKEND_URL=${aiStudio.backendUrl}\nOWLY_BACKEND_SECRET=${aiStudioSecret}`);
      setCopiedAiStudio(true);
      setNotice("A két környezeti változó a vágólapra került. Csak az AI Studio Cloud Run titkos beállításai közé illeszd be.");
    } catch { setError("A vágólap nem érhető el. Jelöld ki és másold ki külön a két értéket."); }
  }
  return <>
    <Header title="Integrations" description="Külső rendszerek és importok" />
    <div className="max-h-[calc(100vh-4rem)] overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Integrációk állapota">
        <a href="#notion" className="flex items-center gap-3 rounded-xl border border-owly-border bg-owly-surface p-4 transition-colors hover:border-owly-primary/40 hover:shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-owly-primary-50 text-owly-primary"><BookOpen className="h-5 w-5" /></span><span className="min-w-0"><span className="block text-sm font-semibold">Notion CRM</span><span className="block text-xs text-owly-text-light">{notionSettings?.enabled ? "Szinkron bekapcsolva" : "Nincs bekapcsolva"}</span></span></a>
        <a href="#whatsapp-fallback" className="flex items-center gap-3 rounded-xl border border-owly-border bg-owly-surface p-4 transition-colors hover:border-owly-primary/40 hover:shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><MessageCircle className="h-5 w-5" /></span><span className="min-w-0"><span className="block text-sm font-semibold">WhatsApp fallback</span><span className="block text-xs text-owly-text-light">{providerState?.fallbackEnabled ? "Tartalék küldés aktív" : "Nincs bekapcsolva"}</span></span></a>
        <a href="#rocketsender" className="flex items-center gap-3 rounded-xl border border-owly-border bg-owly-surface p-4 transition-colors hover:border-owly-primary/40 hover:shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Send className="h-5 w-5" /></span><span className="min-w-0"><span className="block text-sm font-semibold">RocketSender</span><span className="block text-xs text-owly-text-light">{data?.settings.mode === "disabled" ? "Kikapcsolva" : data?.settings.compatibilityVerified ? "Próba ellenőrizve" : "Beállítás szükséges"}</span></span></a>
        <a href="#ai-studio" className="flex items-center gap-3 rounded-xl border border-owly-border bg-owly-surface p-4 transition-colors hover:border-owly-primary/40 hover:shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><KeyRound className="h-5 w-5" /></span><span className="min-w-0"><span className="block text-sm font-semibold">AI Studio · Cloud Run</span><span className="block text-xs text-owly-text-light">{aiStudio?.hasSecret ? "Kulcs beállítva" : "Nincs összekötve"}</span></span></a>
      </div>
      {(notice || error) && <div role={error ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>{error || notice}</div>}
      <IntegrationCard id="ai-studio" title="Google AI Studio · Cloud Run" description="Hitelesített Owly-kapcsolat az AI Studio háttérszolgáltatásához" status={aiStudio?.hasSecret ? "Kulcs beállítva" : "Nincs összekötve"} active={aiStudio?.hasSecret} icon={KeyRound}>
        <div className="rounded-lg border border-owly-primary/20 bg-owly-primary-50/60 p-4 text-sm text-owly-text">
          <p className="font-medium">Ezt a két értéket add meg az AI Studio Cloud Run környezeti változói között.</p>
          <p className="mt-1 text-owly-text-light">Az Owly-cím a Renderen futó alkalmazásra mutat. A megosztott titok csak jogosultságot ad az alábbi állapot-ellenőrző API-hoz; az Owly nem kapja meg és nem tárolja a Google AI Studio kulcsát.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-owly-text">OWLY_BACKEND_URL<input className={field} readOnly value={aiStudio?.backendUrl || ""} /></label>
          <label className="block text-sm font-medium text-owly-text">Állapot-ellenőrző végpont<input className={field} readOnly value={aiStudio?.healthUrl || ""} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-owly-border bg-owly-bg p-3">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${aiStudio?.whatsapp.connected ? "bg-emerald-50 text-emerald-700" : "bg-owly-surface text-owly-text-light"}`}>WhatsApp Web: {aiStudio?.whatsapp.connected ? "csatlakoztatva" : "nincs csatlakoztatva"}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${aiStudio?.whatsapp.processingEnabled ? "bg-emerald-50 text-emerald-700" : "bg-owly-surface text-owly-text-light"}`}>Üzenetfeldolgozás: {aiStudio?.whatsapp.processingEnabled ? "bekapcsolva" : "kikapcsolva"}</span>
          {aiStudio?.lastUsedAt && <span className="text-xs text-owly-text-light">A Cloud Run legutóbb {new Date(aiStudio.lastUsedAt).toLocaleString("hu-HU")} időpontban ellenőrizte a kapcsolatot.</span>}
        </div>
        {aiStudioSecret && <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Másold át most a titkot az AI Studio Cloud Run beállításaiba. Az Owly újratöltés után már nem tudja megjeleníteni.</p>
          <label className="block text-sm font-medium text-owly-text">OWLY_BACKEND_SECRET<input className={field} type="password" autoComplete="new-password" readOnly value={aiStudioSecret} onFocus={event => event.currentTarget.select()} /></label>
          <button type="button" className={primaryButton} disabled={busy} onClick={copyAiStudioEnvironment}>{copiedAiStudio ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copiedAiStudio ? "Környezeti változók másolva" : "OWLY_BACKEND_URL és titok másolása"}</button>
        </div>}
        {!aiStudioSecret && aiStudio?.hasSecret && <p className="text-sm text-owly-text-light">Titok elmentve · végződés: …{aiStudio.secretHint}. Ha az AI Studio még nem kapcsolódik, ellenőrizd, hogy a Cloud Run szolgáltatásban is ugyanez a titok szerepel.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} disabled={busy || !aiStudio} onClick={rotateAiStudioSecret}>{aiStudio?.hasSecret ? "Megosztott titok cseréje" : "AI Studio-kulcs létrehozása"}</button>
          {aiStudio?.hasSecret && <button type="button" className={button} disabled={busy} onClick={revokeAiStudioSecret}>Kapcsolat visszavonása</button>}
        </div>
        <div className="space-y-2 border-t border-owly-border pt-4 text-sm text-owly-text-light">
          <p>Cloud Run beállítási lépések:</p>
          <ol className="list-decimal space-y-1 pl-5"><li>Hozd létre vagy cseréld a kulcsot itt.</li><li>Az <code>OWLY_BACKEND_URL</code> és <code>OWLY_BACKEND_SECRET</code> értékét mentsd el az AI Studio Cloud Run titkos környezeti változói közé.</li><li>Indítsd újra a Cloud Run szolgáltatást; az állapot-ellenőrzéshez a fenti URL-t hívd <code>Authorization: Bearer &lt;OWLY_BACKEND_SECRET&gt;</code> fejlécével.</li></ol>
          <p>Az állapot-végpont csak a kapcsolatot, a WhatsApp-bővítmény állapotát és az AI-szolgáltató beállítottságát jelzi. A Cloud Run Chromium-munkamenetét ez nem hozza létre és nem párosítja.</p>
        </div>
      </IntegrationCard>
      <IntegrationCard id="notion" title="Notion CRM" description="Ügyfelek és beszélgetések kézi szinkronizálása" status={notionSettings?.enabled ? "Szinkron aktív" : "Kikapcsolva"} active={notionSettings?.enabled} icon={BookOpen}>
        <p>Az Owly ügyfeleit és beszélgetéseit egy Notion-adatbázisba másolja. A beszélgetés sorába legfeljebb az utolsó 20 üzenet kerül, a szöveg legfeljebb 2000 karakter. A szinkron egyirányú és kézi indítású; az Owly ID alapján frissít, így az ismételt futtatás nem hoz létre új sort.</p>
        <label className="block text-sm font-medium text-owly-text">Notion integrációs API-kulcs<input className={field} type="password" autoComplete="new-password" value={notionForm.token} onChange={event => setNotionForm({ ...notionForm, token: event.target.value })} placeholder={notionSettings?.hasToken ? "Már elmentve · üresen hagyva változatlan" : "secret_… vagy ntn_…"} /></label>
        <label className="block text-sm font-medium text-owly-text">Notion ügyfél-adatbázis azonosítója<input className={field} value={notionForm.databaseId} onChange={event => setNotionForm({ ...notionForm, databaseId: event.target.value })} placeholder="A Notion-adatbázis URL-jéből" /></label>
        <p className="text-sm text-owly-text-light">Az adatbázist oszd meg a Notion-integrációval. Kell benne egy Cím típusú oszlop és egy „Owly ID” nevű Szöveg oszlop. A Phone, WhatsApp, Email, Tags, Channel, Status, Summary, Messages, Type és Last contact oszlopokat a szinkron automatikusan kitölti, ha hozzáadod őket a megfelelő tulajtípussal.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={notionForm.enabled} onChange={event => setNotionForm({ ...notionForm, enabled: event.target.checked })} /> Notion-szinkron engedélyezése</label>
        <div className="flex flex-wrap gap-2"><button className={primaryButton} disabled={busy} onClick={() => notionAction("save")}>Beállítások mentése</button><button className={button} disabled={busy || !notionSettings?.hasToken || !notionForm.databaseId} onClick={() => notionAction("test")}>Kapcsolat ellenőrzése</button><button className={button} disabled={busy || !notionSettings?.enabled} onClick={() => notionAction("sync")}>Ügyfelek és beszélgetések szinkronizálása</button></div>
        {notionSettings?.lastSyncAt && <p className="text-sm text-owly-text-light">Utolsó szinkron: {new Date(notionSettings.lastSyncAt).toLocaleString("hu-HU")}</p>}
        {notionSettings?.lastSyncError && <p className="text-sm text-red-700">Legutóbbi hiba: {notionSettings.lastSyncError}</p>}
      </IntegrationCard>
      <IntegrationCard id="whatsapp-fallback" title="WhatsApp tartalék szolgáltatók" description="Infobip és Peach üzenetküldés biztonságos tartalékként" status={providerState?.fallbackEnabled ? "Tartalék aktív" : "Kikapcsolva"} active={providerState?.fallbackEnabled} icon={MessageCircle}>
        <p>Az Owly Chrome-bővítményben elkészült választervezet 15 percig vár. Ha addig nem igazolódik a WhatsApp-küldés, a kiválasztott szolgáltató ugyanazt a tervezetet küldi el. Bizonytalan küldési eredménynél nem próbálkozik újra.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={providerForm.fallbackEnabled} onChange={e => setProviderForm({ ...providerForm, fallbackEnabled: e.target.checked })} /> Tartalék küldés bekapcsolása</label>
        <label className="block text-sm font-medium text-owly-text">Tartalék szolgáltató<select className={field} value={providerForm.fallbackProvider} onChange={e => setProviderForm({ ...providerForm, fallbackProvider: e.target.value as "infobip" | "peach" })}><option value="infobip">Infobip</option><option value="peach">Peach</option></select></label>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-3 rounded-lg border border-owly-border p-4">
            <h3 className="font-medium">Infobip · teljes szöveges WhatsApp</h3>
            <label className="block text-sm font-medium text-owly-text">Base URL<input className={field} value={providerForm.infobip.baseUrl} onChange={e => setProviderForm({ ...providerForm, infobip: { ...providerForm.infobip, baseUrl: e.target.value } })} placeholder="xxxxx.api.infobip.com" /></label>
            <label className="block text-sm font-medium text-owly-text">WhatsApp feladó<input className={field} value={providerForm.infobip.sender} onChange={e => setProviderForm({ ...providerForm, infobip: { ...providerForm.infobip, sender: e.target.value } })} placeholder="jóváhagyott feladószám" /></label>
            <label className="block text-sm font-medium text-owly-text">API-kulcs<input className={field} type="password" autoComplete="new-password" value={providerForm.infobip.apiKey} onChange={e => setProviderForm({ ...providerForm, infobip: { ...providerForm.infobip, apiKey: e.target.value } })} placeholder={providerState?.infobip.hasApiKey ? "Már elmentve · üresen hagyva változatlan" : "Infobip API-kulcs"} /></label>
            <label className="block text-sm font-medium text-owly-text">Webhook titok<input className={field} type="password" autoComplete="new-password" value={providerForm.infobip.webhookToken} onChange={e => setProviderForm({ ...providerForm, infobip: { ...providerForm.infobip, webhookToken: e.target.value } })} placeholder={providerState?.infobip.hasWebhookToken ? "Már elmentve · üresen hagyva változatlan" : "Egyedi, hosszú titok"} /></label>
            {providerWebhooks && <p className="break-all text-xs text-owly-text-light">Bejövő webhook: {providerWebhooks.infobip} · fejléc: X-Owly-Webhook-Token</p>}
          </div>
          <div className="space-y-3 rounded-lg border border-owly-border p-4">
            <h3 className="font-medium">Peach · folyamat alapú küldés</h3>
            <label className="block text-sm font-medium text-owly-text">Peach-folyamat azonosító<input className={field} value={providerForm.peach.flowId} onChange={e => setProviderForm({ ...providerForm, peach: { ...providerForm.peach, flowId: e.target.value } })} placeholder="flw_…" /></label>
            <label className="block text-sm font-medium text-owly-text">API-kulcs<input className={field} type="password" autoComplete="new-password" value={providerForm.peach.apiKey} onChange={e => setProviderForm({ ...providerForm, peach: { ...providerForm.peach, apiKey: e.target.value } })} placeholder={providerState?.peach.hasApiKey ? "Már elmentve · üresen hagyva változatlan" : "Peach API-kulcs"} /></label>
            <label className="block text-sm font-medium text-owly-text">Webhook titok<input className={field} type="password" autoComplete="new-password" value={providerForm.peach.webhookToken} onChange={e => setProviderForm({ ...providerForm, peach: { ...providerForm.peach, webhookToken: e.target.value } })} placeholder={providerState?.peach.hasWebhookToken ? "Már elmentve · üresen hagyva változatlan" : "Egyedi, hosszú titok"} /></label>
            <p className="text-xs text-owly-text-light">A Peach API egy beállított App-folyamatot indít. A folyamatban a message változót kell használni.</p>
            {providerWebhooks && <p className="break-all text-xs text-owly-text-light">Bejövő webhook: {providerWebhooks.peach} · fejléc: X-Owly-Webhook-Token</p>}
          </div>
        </div>
        <button className={primaryButton} disabled={busy} onClick={saveProviders}>Szolgáltatók mentése</button>
        <div className="border-t border-owly-border pt-3 space-y-2">
          <h3 className="font-medium">Tartalékküldési napló</h3>
          {fallbackEvents.length === 0 ? <p className="text-sm text-owly-text-light">Még nincs várakozó tartalékküldés.</p> : fallbackEvents.map(event => <div key={event.id} className="text-sm border-t border-owly-border pt-2"><span>{new Date(event.createdAt).toLocaleString("hu-HU")} · {event.customerContact} · {event.fallbackProvider} · {event.status}</span>{event.lastErrorCode && <span className="ml-2 text-red-700">{event.lastErrorCode}</span>}</div>)}
        </div>
      </IntegrationCard>
      <IntegrationCard id="rocketsender" title="RocketSender" description="Válaszimport, kontaktkezelés és küldési napló" status={data?.settings.mode === "disabled" ? "Kikapcsolva" : data?.settings.compatibilityVerified ? "Próba ellenőrizve" : "Ellenőrzés szükséges"} active={data?.settings.mode !== "disabled" && data?.settings.compatibilityVerified} icon={Send}>
        <p>Csak korábban nyilvántartott megkeresésre érkező ügyfélválasz hoz létre vagy frissít ügyfelet. A kiküldés, kézbesítés és elolvasás nem indít importot.</p>
        <label className="block text-sm font-medium text-owly-text">Saját WhatsApp-fiók telefonszáma<input className={field} type="tel" value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })} placeholder="+36…" /></label>
        <label className="block text-sm font-medium text-owly-text">Külön teszttelefon száma<input className={field} type="tel" value={form.trialPhone} onChange={e => setForm({ ...form, trialPhone: e.target.value })} placeholder="+36…" /></label>
        <label className="block text-sm font-medium text-owly-text">Import módja<select className={field} value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}><option value="disabled">Kikapcsolva</option><option value="trial">Próba – csak a tesztszám válaszai</option><option value="active" disabled={!data?.settings.compatibilityVerified}>Bekapcsolva – nyilvántartott megkeresések válaszai</option></select></label>
        <p><label className="flex items-center gap-2"><input type="checkbox" checked disabled readOnly /> Duplikációvédelem mindig bekapcsolva</label></p>
        <p><label className="flex items-center gap-2"><input type="checkbox" checked={form.aiSuggestions} disabled={busy || form.mode === "disabled"} onChange={event => setForm({ ...form, aiSuggestions: event.target.checked })} /> AI-válaszjavaslatok engedélyezése</label></p>
        <p><label className="flex items-center gap-2 text-owly-text-light"><input type="checkbox" checked={false} disabled readOnly /> Automatikus WhatsApp-üzenetküldés – a próbamódban sem támogatott</label></p>
        <button className={primaryButton} disabled={busy} onClick={() => submit({ action: "configure", ...form })}>Beállítások mentése</button>
      </IntegrationCard>
      <IntegrationCard id="rocketsender-contacts" title="RocketSender-kontaktok" description="Kontaktlista importálása és hozzájárult ügyfelek exportja" icon={Users}>
        <p>CSV-ből importálhatsz ügyfeleket az Owlyba. Ha válaszolnak a nyilvántartott üzenetre, az Owly automatikusan „active” címkét ad nekik. RocketSenderbe csak nem blokkolt, igazolt WhatsApp-hozzájárulással rendelkező kontaktokat exportálunk; a telefonszám nyilvános céges adatbázisban való megtalálása önmagában nem hozzájárulás.</p>
        <a className="underline" href="/rocketsender-contacts-template.csv" download>Kontakt-sablon letöltése</a>
        <label className="block text-sm font-medium text-owly-text">Kontaktlista importálása (.csv, legfeljebb 250 sor)<input className={field} type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importRocketContacts(file); }} /></label>
        <p className="text-sm text-owly-text-light">Cégnév kereséséhez nyisd meg a kontaktot az Ügyfelek oldalon. A keresés pontos, nyilvános céges telefonszám-egyezést használ, forrást mutat, és csak jóváhagyásodra ment nevet. Magánszemélyt nem próbál azonosítani.</p>
        <a className={button + " inline-block"} href="/api/integrations/rocketsender/contacts">Hozzájárult kontaktok exportja RocketSenderhez</a>
        <p className="text-xs text-owly-text-light">Az „active” címke válaszadási aktivitást jelzi; önmagában nem jelent marketing-hozzájárulást.</p>
      </IntegrationCard>
      <IntegrationCard id="rocketsender-sends" title="Tényleges küldések nyilvántartása" description="Sikeresen elküldött kampányüzenetek rögzítése" icon={Send}>
        <p>A RocketSender jelenleg nem igazolt webhookforrás. A sikeres küldések eredményét a sablon szerinti CSV/JSON-fájlból rögzítheted. Ez még nem hoz létre Owly-ügyfelet. Egy címzettlista vagy a tervezett küldési idő nem elegendő.</p>
        <p>Az Excel-eredményt előbb mentsd CSV-ként, és igazítsd a sablonhoz. Csak a <code>sent</code> állapotú sorok fogadhatók el. A tényleges időpontot nem pótoljuk a feltöltés időpontjával.</p>
        <a className="underline" href="/rocketsender-sent-template.csv" download>Küldési sablon letöltése</a>
        <label className="block text-sm font-medium text-owly-text">Kampányazonosító<input className={field} value={campaign} onChange={e => setCampaign(e.target.value)} /></label>
        <label className="block text-sm font-medium text-owly-text">Sikeres küldési napló feltöltése<input className={field} type="file" accept=".csv,.json,text/csv,application/json" disabled={busy || !form.accountId || !campaign.trim()} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          if (file.size > 128000) { setError("Legfeljebb 128 kB-os fájl tölthető fel."); return; }
          try { await submit(parseRegistryFile(await file.text(), form.accountId, campaign), "/outbound", "Küldési napló rögzítve. Ügyfél még nem jött létre."); }
          catch (error) { setError(error instanceof Error ? error.message : "A fájl nem olvasható."); }
        }} /></label>
        <p>{data?.sent || 0} küldés nyilvántartva · {data?.pending || 0} feldolgozásra váró esemény</p>
      </IntegrationCard>
      <IntegrationCard id="rocketsender-test" title="Kapcsolati próba" description="Tesztválasz feldolgozása és ismétlődés ellenőrzése" icon={CheckCircle2}>
        <ol className="list-decimal pl-5 space-y-2"><li>Mentsd el a saját WhatsApp-fiók és egy másik teszttelefon számát, próba módban.</li><li>A RocketSenderrel küldj egy üzenetet a teszttelefonra. Rögzítsd a sikeres küldést a fenti naplóban.</li><li>A másik telefonról válaszolj. Ellenőrizd a Customers és Conversations oldalakon az új profilt és az eredeti időpontokat.</li><li>Az alábbi ellenőrzés újrafeldolgozza ugyanazt az eseményazonosítót; ez nem küld üzenetet.</li></ol>
        <label className="block text-sm font-medium text-owly-text"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> A próbát valóban RocketSenderrel végeztem, és az importált választ ellenőriztem.</label>
        <button className={primaryButton} disabled={busy || !confirmed} onClick={() => submit({ action: "verify", confirmed }, "", "A tesztválasz és a duplikációpróba ellenőrizve. Az aktív mód külön menthető.")}>Duplikációpróba és kapcsolat ellenőrzése</button>
      </IntegrationCard>
      {data && data.dead > 0 && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{data.dead} import tartós hibával leállt. Javítás után az importnaplóban újraindítható.</p>}
      <IntegrationCard id="rocketsender-log" title="Importnapló" description="Várakozó, sikeres vagy hibás importesemények áttekintése" status={data ? `${data.pending} várakozik · ${data.dead} hibás` : "Betöltés…"} active={!!data && data.dead === 0} icon={Activity}>
        <button className={button} disabled={busy} onClick={() => submit({ action: "drain" }, "", "Az esedékes importok feldolgozása megtörtént.")}>Várakozó események feldolgozása</button>
        <p>A függő események az adatbázisban megmaradnak. A nyitott Chrome-bővítmény rendszeresen újrapróbálja őket; bezárt böngésző vagy alvó ingyenes Render esetén a folytatás a következő eléréskor történik.</p>
        {!data?.events.length && <p>Még nincs importesemény.</p>}
        {data?.events.map(event => <div key={event.id} className="border-t border-owly-border py-3 text-sm"><p>{new Date(event.createdAt).toLocaleString("hu-HU")} · {event.status} · {event.attempts} újrapróbálkozás</p>{event.lastErrorCode && <p>{event.lastErrorCode}</p>}{event.customerId && <a className="underline mr-3" href="/customers">Ügyfél megtekintése</a>}{event.conversationId && <a className="underline mr-3" href="/conversations">Beszélgetés megtekintése</a>}{event.status === "dead" && <button className={button} disabled={busy} onClick={() => submit({ action: "retry", eventId: event.id })}>Újrapróbálás</button>}</div>)}
      </IntegrationCard>
      </div>
    </div>
  </>;
}

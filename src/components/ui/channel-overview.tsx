"use client";
import { useEffect, useState } from "react";
import { Mail, MessageCircle, Phone } from "lucide-react";

export function ChannelOverview() {
  const [channels, setChannels] = useState<Record<string, { connected: boolean; enabled: boolean; pending: boolean }>>({});
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/channels", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const rows = await response.json();
        const next: typeof channels = {};
        for (const row of rows) {
          const config = row.config || {};
          const browser = config.mode === "browser";
          next[row.type] = { connected: row.status === "connected", enabled: browser ? config.browserEnabled === true : row.isActive === true,
            pending: browser && !!config.browserControlRevision && config.browserControlRevision !== config.browserAppliedRevision };
        }
        if (active) { setChannels(next); setError(false); }
      } catch { if (active) setError(true); }
    }
    refresh(); const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <div className="p-5 space-y-4">
    {error && <p role="alert" className="text-xs text-red-600">A csatornaállapot nem kérdezhető le.</p>}
    {[{ type: "whatsapp", name: "WhatsApp", icon: MessageCircle, color: "text-green-600" }, { type: "email", name: "Email", icon: Mail, color: "text-blue-600" }, { type: "phone", name: "Phone", icon: Phone, color: "text-purple-600" }].map(item => {
      const value = channels[item.type];
      return <div key={item.type} className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5"><item.icon className={`h-4 w-4 ${item.color}`} /><div><span className="text-sm font-medium">{item.name}</span><p className={`text-xs ${value?.enabled ? "text-green-600" : "text-owly-text-light"}`}>{!value ? "Állapot betöltése…" : value.pending ? "Állapotváltás folyamatban…" : value.enabled ? "Feldolgozás engedélyezve" : "Feldolgozás kikapcsolva"}</p></div></div>
        {value && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${value.connected ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>{value.connected ? "Connected" : "Disconnected"}</span>}
      </div>;
    })}
  </div>;
}

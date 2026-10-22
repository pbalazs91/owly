"use client";

import { Bell, Search, Sun, Moon, LogOut, User } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/lib/hooks/use-theme";
import { useRouter } from "next/navigation";
import { GlobalSearch } from "./global-search";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ total: number; items: { id: string; title: string; href: string }[] }>({ total: 0, items: [] });
  const [notificationError, setNotificationError] = useState("");
  const notificationRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error();
        if (active) { setNotifications(data); setNotificationError(""); }
      } catch { if (active) setNotificationError("Az értesítések nem tölthetők be."); }
    }
    refresh(); const timer = setInterval(refresh, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) setNotificationsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/login");
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-owly-surface border-b border-owly-border transition-theme">
      <div className="animate-fade-in">
        <h2 className="text-xl font-semibold text-owly-text">{title}</h2>
        {description && (
          <p className="text-sm text-owly-text-light mt-0.5">{description}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className="p-2 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors"
          title="Search"
        >
          <Search className="h-5 w-5" />
        </button>

        <button
          onClick={toggleTheme}
          className="p-2 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors"
          title={theme === "light" ? "Dark mode" : "Light mode"}
          aria-pressed={theme === "dark"}
        >
          {theme === "light" ? (
            <Moon className="h-5 w-5" />
          ) : (
            <Sun className="h-5 w-5" />
          )}
        </button>

        <div ref={notificationRef} className="relative" onKeyDown={e => { if (e.key === "Escape") setNotificationsOpen(false); }}>
        <button title="Értesítések" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)} className="relative p-2 text-owly-text-light hover:text-owly-text hover:bg-owly-primary-50 rounded-lg transition-colors">
          <Bell className="h-5 w-5" />
          {!notificationError && notifications.total > 0 && <span aria-label={`${notifications.total} figyelmet igénylő esemény`} className="absolute top-0 right-0 min-w-4 rounded-full bg-owly-danger px-1 text-[10px] text-white">{notifications.total}</span>}
        </button>
        {notificationsOpen && <div role="region" aria-label="Értesítések" className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[85vw] rounded-lg border border-owly-border bg-owly-surface p-4 shadow-lg"><p className="font-medium mb-2">Figyelmet igénylő események</p>{notificationError ? <p role="alert">{notificationError}</p> : notifications.items.length ? notifications.items.map(item => <a key={item.id} href={item.href} className="block border-t border-owly-border py-2 text-sm hover:text-owly-primary">{item.title}</a>) : <p className="text-sm text-owly-text-light">Nincs figyelmet igénylő esemény.</p>}</div>}
        </div>

        {actions}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-owly-primary text-white text-sm font-medium hover:bg-owly-primary-dark transition-colors"
          >
            A
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-owly-surface border border-owly-border rounded-lg shadow-lg py-1 z-50 animate-scale-in transition-theme">
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  router.push("/settings");
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-owly-text hover:bg-owly-primary-50 transition-colors"
              >
                <User className="h-4 w-4" />
                Profile & Settings
              </button>
              <div className="border-t border-owly-border my-1" />
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-owly-danger hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

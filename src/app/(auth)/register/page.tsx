"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "open" | "closed" | "error">("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!active) return;
        if (data.authenticated) {
          router.replace("/channels");
          return;
        }
        setState(data.setupRequired ? "open" : "closed");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setState("closed");
        setError(
          typeof data.error === "string" ? data.error : "A regisztráció nem sikerült. Próbáld újra."
        );
        return;
      }
      setPassword("");
      router.replace("/channels");
    } catch {
      setError("Nem sikerült kapcsolódni. Próbáld újra.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-owly-border bg-owly-bg px-3.5 py-2.5 text-sm text-owly-text focus:outline-none focus:ring-2 focus:ring-owly-primary";
  return (
    <div className="bg-owly-surface rounded-2xl shadow-lg border border-owly-border p-8">
      <div className="flex flex-col items-center mb-7 text-center">
        <Image src="/owly.png" alt="Owly" width={56} height={56} className="mb-4" />
        <h1 className="text-2xl font-bold text-owly-text">
          {state === "closed" ? "A regisztráció lezárult" : "Saját fiók létrehozása"}
        </h1>
        <p className="text-owly-text-light text-sm mt-2">
          {state === "closed"
            ? "Az egyetlen felhasználói fiók már létrejött."
            : "Csak felhasználónév és jelszó szükséges."}
        </p>
      </div>
      {state === "checking" && (
        <p role="status" className="text-center text-sm text-owly-text-light">
          Betöltés…
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-sm text-owly-danger">
          Az ellenőrzés nem sikerült. Frissítsd az oldalt.
        </p>
      )}
      {state === "open" && (
        <form onSubmit={register} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-owly-text mb-1.5">
              Felhasználónév
            </label>
            <input
              id="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={inputClass}
              aria-describedby="username-hint"
            />
            <p id="username-hint" className="mt-1.5 text-xs text-owly-text-light">
              3–32 karakter: betű, szám, pont, kötőjel vagy aláhúzás.
            </p>
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-owly-text mb-1.5">
              Jelszó
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="mt-1.5 text-xs text-owly-text-light">
              Legalább 8 karakter. E-mailes megerősítés nincs.
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-owly-danger"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-owly-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-owly-primary-dark disabled:opacity-60"
          >
            {saving ? "Fiók létrehozása…" : "Regisztráció"}
          </button>
          <p className="text-center text-xs text-owly-text-light">
            Legfeljebb 1 felhasználói fiók hozható létre.
          </p>
        </form>
      )}
      {state === "closed" && (
        <Link
          href="/login"
          className="block w-full rounded-lg bg-owly-primary px-4 py-2.5 text-center text-sm font-semibold text-white"
        >
          Bejelentkezés
        </Link>
      )}
    </div>
  );
}

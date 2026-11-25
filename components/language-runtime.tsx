"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGUAGES, setDocumentLanguage, translateText, type Language } from "@/lib/i18n";

const STORAGE_KEY = "videox.language";

interface LanguageValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string) => string;
}

const fallback: LanguageValue = {
  language: "fr",
  setLanguage: () => undefined,
  t: (text) => text,
};

const LanguageContext = createContext<LanguageValue>(fallback);

export function useLanguage(): LanguageValue {
  return useContext(LanguageContext);
}

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGES.some((item) => item.code === value);
}

function detectInitialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage can be unavailable in private browsing; fall through.
  }
  const candidates: unknown[] = [];
  if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  candidates.push(navigator.language);
  for (const candidate of candidates) {
    const base = typeof candidate === "string" ? candidate.toLowerCase().split("-")[0] : "";
    if (isLanguage(base)) return base;
  }
  return "fr";
}

/** Single source of truth for language. Never mutates nodes React owns. */
export function LanguageRuntime({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("fr");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = detectInitialLanguage();
    setDocumentLanguage(initial);
    // Deliberate client-only initialisation after hydration; a lazy useState
    // reading localStorage would produce a server/client markup mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLanguageState(initial);
    setReady(true);
  }, []);

  function choose(next: Language) {
    setLanguageState(next);
    setDocumentLanguage(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; the in-memory selection still works.
    }
    window.dispatchEvent(new CustomEvent("videox:languagechange", { detail: { language: next } }));
  }

  const value = useMemo<LanguageValue>(
    () => ({
      language: ready ? language : "fr",
      setLanguage: choose,
      t: (text: string) => translateText(text, ready ? language : "fr"),
    }),
    [language, ready],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

const SWITCHER_LABEL: Record<Language, string> = {
  en: "Language",
  fr: "Langue",
  sw: "Lugha",
};

/** Inline, accessible selector designed to sit in a toolbar — never floating over content. */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useLanguage();
  return (
    <div className={`lang-switch${compact ? " compact" : ""}`} role="group" aria-label={SWITCHER_LABEL[language]}>
      {!compact ? <span className="lang-switch-label">{SWITCHER_LABEL[language]}</span> : null}
      <div className="lang-switch-options">
        {LANGUAGES.map((item) => (
          <button
            key={item.code}
            type="button"
            aria-pressed={language === item.code}
            title={item.name}
            onClick={() => setLanguage(item.code)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

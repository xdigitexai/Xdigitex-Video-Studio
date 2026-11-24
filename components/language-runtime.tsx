"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LANGUAGES,
  applyLanguage,
  type Language,
  setDocumentLanguage,
  startLanguageObserver,
  translateText,
} from "@/lib/i18n";

const STORAGE_KEY = "videox.language";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGES.some((item) => item.code === value);
}

function detectInitialLanguage(): Language {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (isLanguage(saved)) return saved;

  const candidates: unknown[] = [];
  if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  candidates.push(navigator.language);
  for (const candidate of candidates) {
    const base = typeof candidate === "string" ? candidate.toLowerCase().split("-")[0] : "";
    if (isLanguage(base)) return base;
  }
  return "fr";
}
const SWITCHER_LABEL: Record<Language, string> = {
  en: "Language",
  fr: "Langue",
  sw: "Lugha",
};

export function LanguageRuntime({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("fr");
  const originalTitle = useRef<string>("");

  useEffect(() => {
    originalTitle.current = document.title;
    const initial = detectInitialLanguage();
    setDocumentLanguage(initial);
    applyLanguage(initial);
    setLanguageState(initial);
    document.title = translateText(originalTitle.current, initial);
    return startLanguageObserver();
  }, []);

  function choose(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    setDocumentLanguage(next);
    document.title = translateText(originalTitle.current, next);
    window.dispatchEvent(new CustomEvent("videox:languagechange", { detail: { language: next } }));
  }

  return (
    <>
      {children}
      <div className="lang-switch" role="group" aria-label={SWITCHER_LABEL[language]}>
        <span className="lang-switch-label">{SWITCHER_LABEL[language]}</span>
        <div className="lang-switch-options">
          {LANGUAGES.map((item) => (
            <button
              key={item.code}
              type="button"
              aria-pressed={language === item.code}
              title={item.name}
              onClick={() => choose(item.code)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

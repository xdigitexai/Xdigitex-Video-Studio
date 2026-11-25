"use client";

import type { ReactNode } from "react";
import { useLanguage } from "./language-runtime";

/** Render-time translation for interface strings. Safe inside React trees. */
export function T({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  if (typeof children !== "string") return <>{children}</>;
  return <>{t(children)}</>;
}

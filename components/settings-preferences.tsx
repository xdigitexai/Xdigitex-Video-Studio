"use client";

import { useRouter } from "next/navigation";
import { Languages, LogOut } from "lucide-react";
import { LanguageSwitch } from "./language-runtime";

export function SettingsPreferences() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="card">
      <div className="card-head"><h3>Preferences</h3></div>
      <div className="card-body stack">
        <div className="row-between wrap" style={{ gap: 10 }}>
          <span className="row small" style={{ gap: 8 }}><Languages size={15} /> Interface language</span>
          <LanguageSwitch />
        </div>
        <p className="tiny muted">Your choice is saved on this device and applied across the workspace.</p>
        <button className="btn btn-secondary btn-block" onClick={signOut}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}

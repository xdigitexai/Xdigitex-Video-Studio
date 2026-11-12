"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") || "",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Could not reset your password.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Your reset link is single-use and expires after 60 minutes."
      footer={
        <>
          <Link href="/login">Back to sign in</Link>
        </>
      }
    >
      <form onSubmit={submit}>
        {error ? <div className="notice notice-error mb-2">{error}</div> : null}
        {!token ? <div className="notice notice-warn mb-2">This link is missing its token.</div> : null}
        <div className="field">
          <label className="label" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="confirm">
            Confirm new password
          </label>
          <input
            id="confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="Repeat your password"
            required
          />
        </div>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !token}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </AuthShell>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderCircle, Mail } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; devResetUrl?: string };
      if (!response.ok) {
        setError(data.error || "Could not send the reset link.");
        return;
      }
      setSent(true);
      if (data.devResetUrl) setDevLink(data.devResetUrl);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account email and we'll send a secure reset link."
      footer={
        <>
          <Link href="/login">Back to sign in</Link>
          <Link href="/register">Create an account</Link>
        </>
      }
    >
      {sent ? (
        <div className="stack">
          <div className="notice notice-success">
            If an account exists for {email}, a reset link is on its way. It expires in 60 minutes.
          </div>
          {devLink ? (
            <div className="notice notice-warn" style={{ flexDirection: "column" }}>
              <strong>Development mode</strong>
              <a href={devLink} style={{ color: "var(--lime)", wordBreak: "break-all" }}>
                {devLink}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={submit}>
          {error ? <div className="notice notice-error mb-2">{error}</div> : null}
          <div className="field">
            <label className="label" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@studio.com"
              required
            />
          </div>
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Mail size={17} />}
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

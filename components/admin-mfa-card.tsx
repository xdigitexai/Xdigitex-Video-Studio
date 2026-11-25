"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";

interface MfaStatus {
  enabled: boolean;
  verified: boolean;
  enrolled: boolean;
}

export function AdminMfaCard() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/mfa", { cache: "no-store" });
    if (response.ok) setStatus((await response.json()) as MfaStatus);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setup() {
    setBusy("setup");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/mfa", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { secret?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not start MFA setup.");
      setSecret(data.secret ?? "");
      setMessage(data.message ?? "Enter the 6-digit code from your authenticator app.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start MFA setup.");
    } finally {
      setBusy("");
    }
  }

  async function verify() {
    setBusy("verify");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not verify that code.");
      setSecret("");
      setCode("");
      setMessage("Authenticator verified. MFA is active for this admin account.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify that code.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Admin security</h3>
          <p>Optional TOTP MFA for privileged access.</p>
        </div>
        <ShieldCheck size={16} className="muted" />
      </div>
      <div className="card-body stack">
        {error ? <div className="notice notice-error">{error}</div> : null}
        {message ? <div className="notice notice-success">{message}</div> : null}
        {status ? (
          <div className="row-between">
            <span className="small muted">Two-factor authentication</span>
            <span className={`badge ${status.enabled && status.verified ? "badge-ok" : "badge-warn"}`}>
              {status.enabled ? (status.verified ? "ENABLED" : "VERIFY SESSION") : "OFF"}
            </span>
          </div>
        ) : null}
        {status?.enabled && !status.verified ? (
          <>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button className="btn btn-primary btn-block" onClick={verify} disabled={busy !== "" || code.length !== 6}>
              {busy === "verify" ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
              Verify admin session
            </button>
          </>
        ) : null}
        {status && !status.enabled ? (
          secret ? (
            <>
              <p className="tiny muted">Add this secret to your authenticator app, then confirm with a code.</p>
              <code className="mfa-secret">{secret}</code>
              <input
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <button className="btn btn-primary btn-block" onClick={verify} disabled={busy !== "" || code.length !== 6}>
                {busy === "verify" ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
                Enable MFA
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-block" onClick={setup} disabled={busy !== ""}>
              {busy === "setup" ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
              Set up authenticator
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

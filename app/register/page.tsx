"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, UserPlus } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState("");

  const strong = password.length >= 8;
  const matches = password.length > 0 && password === confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        requiresVerification?: boolean;
        devVerificationUrl?: string;
      };
      if (!response.ok) {
        setError(data.error || "Could not create your account.");
        return;
      }
      if (data.requiresVerification === false) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setSent(true);
      if (data.devVerificationUrl) setDevLink(data.devVerificationUrl);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle={`We sent a verification link to ${email}.`}
        footer={
          <>
            <span>
              Already verified? <Link href="/login">Sign in</Link>
            </span>
          </>
        }
      >
        <div className="notice notice-info mb-2">
          Click the link in your email to activate your studio. The link expires in 24 hours.
        </div>
        {devLink ? (
          <div className="notice notice-warn mb-2" style={{ flexDirection: "column" }}>
            <strong>Development mode</strong>
            <a href={devLink} style={{ color: "var(--lime)", wordBreak: "break-all" }}>
              {devLink}
            </a>
          </div>
        ) : null}
        <Link href="/login" className="btn btn-secondary btn-block">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your studio"
      subtitle="Start with a plan, get monthly credits, and generate your first clip today."
      footer={
        <>
          <span>
            Already have an account? <Link href="/login">Sign in</Link>
          </span>
          <Link href="/#pricing">Compare plans</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        {error ? <div className="notice notice-error mb-2">{error}</div> : null}
        <div className="field">
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            className="input"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Alex Mwangi"
            maxLength={80}
          />
        </div>
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
        <div className="field">
          <label className="label" htmlFor="password">
            Password
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
          <div className="strength">
            <i style={{ width: `${Math.min(100, password.length * 9)}%` }} />
          </div>
          <span className="hint">{strong ? "Password length looks good." : "Use 8+ characters."}</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="confirm">
            Confirm password
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
          {confirm ? <span className={`hint ${matches ? "" : "error-text"}`}>{matches ? "Passwords match." : "Passwords do not match."}</span> : null}
        </div>
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <UserPlus size={17} />}
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}

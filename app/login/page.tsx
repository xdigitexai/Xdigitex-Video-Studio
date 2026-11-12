"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, LogIn } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [next] = useState(() => {
    if (typeof window === "undefined") return "/dashboard";
    const target = new URLSearchParams(window.location.search).get("next");
    return target && target.startsWith("/") && !target.startsWith("//") ? target : "/dashboard";
  });
  const [resent, setResent] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCode("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) {
        setError(data.error || "Could not sign in.");
        setCode(data.code || "");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await response.json().catch(() => ({}))) as { devVerificationUrl?: string; error?: string };
    if (!response.ok) {
      setError(data.error || "Could not resend the verification email.");
      return;
    }
    setResent(
      data.devVerificationUrl
        ? "Development mode: use the link below."
        : "Verification email sent. Check your inbox.",
    );
    if (data.devVerificationUrl) window.location.href = data.devVerificationUrl;
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your studio, credits and projects."
      footer={
        <>
          <span>
            New here? <Link href="/register">Create an account</Link>
          </span>
          <Link href="/forgot-password">Forgot password?</Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        {error ? <div className="notice notice-error mb-2">{error}</div> : null}
        {resent ? <div className="notice notice-success mb-2">{resent}</div> : null}
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
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your password"
            required
          />
        </div>
        {code === "EMAIL_NOT_VERIFIED" ? (
          <button type="button" className="btn btn-secondary btn-block mb-2" onClick={resend}>
            Resend verification email
          </button>
        ) : null}
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

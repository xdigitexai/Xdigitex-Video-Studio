"use client";

import { useState } from "react";
import { Check, LoaderCircle, Save } from "lucide-react";

async function post(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status}).`);
  return data;
}

export function ProfileForm({ initialName, email }: { initialName: string; email: string }) {
  const [displayName, setDisplayName] = useState(initialName);
  const [state, setState] = useState<"idle" | "busy" | "ok">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("busy");
    setError("");
    try {
      await post("/api/auth/profile", { displayName }, "PATCH");
      setState("ok");
      window.setTimeout(() => setState("idle"), 2500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
      setState("idle");
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <div className="card-head">
        <div>
          <h3>Profile</h3>
          <p>How your name appears in the studio.</p>
        </div>
      </div>
      <div className="card-body">
        {error ? <div className="notice notice-error mb-2">{error}</div> : null}
        <div className="field">
          <label className="label" htmlFor="displayName">Display name</label>
          <input id="displayName" className="input" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="emailReadonly">Email address</label>
          <input id="emailReadonly" className="input" value={email} readOnly disabled />
          <span className="hint">Email changes require administrator support.</span>
        </div>
        <button className="btn btn-primary" type="submit" disabled={state === "busy" || !displayName.trim()}>
          {state === "busy" ? <LoaderCircle className="spin" size={15} /> : state === "ok" ? <Check size={15} /> : <Save size={15} />}
          {state === "busy" ? "Saving…" : state === "ok" ? "Saved" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "ok">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setState("busy");
    try {
      await post("/api/auth/password", { currentPassword, newPassword });
      setState("ok");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      window.setTimeout(() => setState("idle"), 2500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change password.");
      setState("idle");
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <div className="card-head">
        <div>
          <h3>Password</h3>
          <p>Changing your password signs out every other browser.</p>
        </div>
      </div>
      <div className="card-body">
        {error ? <div className="notice notice-error mb-2">{error}</div> : null}
        {state === "ok" ? <div className="notice notice-success mb-2">Password changed.</div> : null}
        <div className="field">
          <label className="label" htmlFor="currentPassword">Current password</label>
          <input id="currentPassword" className="input" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="newPassword">New password</label>
            <input id="newPassword" className="input" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="confirmPassword">Confirm</label>
            <input id="confirmPassword" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
          </div>
        </div>
        <button className="btn btn-secondary" type="submit" disabled={state === "busy"}>
          {state === "busy" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {state === "busy" ? "Updating…" : "Update password"}
        </button>
      </div>
    </form>
  );
}

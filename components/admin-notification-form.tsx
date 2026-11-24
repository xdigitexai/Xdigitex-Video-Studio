"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";

export interface CustomerOption {
  id: string;
  email: string;
  displayName: string;
}

export function AdminNotificationForm({ customers }: { customers: CustomerOption[] }) {
  const [userId, setUserId] = useState(customers[0]?.id ?? "");
  const [category, setCategory] = useState("promo");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, category, subject, message }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; to?: string };
      if (!response.ok) {
        setResult({ ok: false, text: data.error || "Email delivery failed." });
      } else {
        setResult({ ok: true, text: `Email sent to ${data.to ?? "the customer"}.` });
        setSubject("");
        setMessage("");
      }
    } catch {
      setResult({ ok: false, text: "Network error. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  if (!customers.length) {
    return <div className="card"><div className="card-body muted">No customers found.</div></div>;
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head"><h3>Send an individual email</h3></div>
      <div className="card-body stack">
        <p className="muted small">Send an individual email to one customer.</p>
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="notification-customer">Select customer</label>
            <select
              className="input"
              id="notification-customer"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              required
            >
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.displayName} · {customer.email}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="notification-category">Category</label>
            <select
              className="input"
              id="notification-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="promo">Promotion</option>
              <option value="billing">Billing reminder</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="notification-subject">Subject</label>
          <input
            className="input"
            id="notification-subject"
            placeholder="Optional — a category subject is used when blank"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={140}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="notification-message">Message</label>
          <textarea
            className="input"
            id="notification-message"
            rows={7}
            placeholder="Write your promotion, billing reminder or personal message."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={4000}
            required
          />
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="submit" disabled={busy || !userId}>
            <Send size={15} /> {busy ? "Sending…" : "Send email"}
          </button>
          {result ? (
            <span className={result.ok ? "badge badge-ok" : "badge badge-danger"}>
              {result.ok ? "Sent" : "Failed"}: {result.text}
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Undo2 } from "lucide-react";

export function PaymentActions({
  paymentId,
  status,
  canReconcile,
  hasReceipt,
}: {
  paymentId: string;
  status: string;
  canReconcile: boolean;
  hasReceipt: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function run(action: "reconcile" | "refund") {
    if (action === "refund" && !window.confirm(`Refund this payment and reverse ${hasReceipt ? "its" : "any"} credits?`)) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/payments/${paymentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: action === "refund" ? "Administrative refund" : undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Action failed.");
        return;
      }
      setMessage(action === "reconcile" ? `Status: ${String(data.status ?? "updated")}` : "Refund recorded.");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="row wrap" style={{ gap: 5 }}>
      {canReconcile ? (
        <button className="btn btn-secondary btn-sm" onClick={() => run("reconcile")} disabled={busy !== ""}>
          {busy === "reconcile" ? <LoaderCircle className="spin" size={12} /> : <RefreshCw size={12} />} Recheck
        </button>
      ) : null}
      {status === "completed" ? (
        <button className="btn btn-danger btn-sm" onClick={() => run("refund")} disabled={busy !== ""}>
          {busy === "refund" ? <LoaderCircle className="spin" size={12} /> : <Undo2 size={12} />} Refund
        </button>
      ) : null}
      {error ? <span className="error-text tiny">{error}</span> : null}
      {message ? <span className="tiny" style={{ color: "var(--lime)" }}>{message}</span> : null}
    </div>
  );
}

export function SweepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sweep() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/sweep", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        payments?: { checked: number; completed: number; stillPending: number; failed: number };
        generations?: { swept: number; refreshed: number };
      };
      if (!response.ok) {
        setError(data.error || "Reconciliation failed.");
        return;
      }
      setMessage(
        `Payments checked ${data.payments?.checked ?? 0}, completed ${data.payments?.completed ?? 0}. Jobs swept ${data.generations?.swept ?? 0}.`,
      );
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row wrap" style={{ gap: 8 }}>
      <button className="btn btn-secondary btn-sm" onClick={sweep} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />} Reconcile pending
      </button>
      {message ? <span className="tiny" style={{ color: "var(--lime)" }}>{message}</span> : null}
      {error ? <span className="error-text tiny">{error}</span> : null}
    </div>
  );
}

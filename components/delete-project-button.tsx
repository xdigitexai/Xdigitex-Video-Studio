"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm(`Delete “${projectName}”? Its media will be permanently removed. Generation history is kept for billing.`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not delete the project.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn btn-ghost btn-sm" onClick={remove} disabled={busy} aria-label={`Delete ${projectName}`}>
        {busy ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
      </button>
      {error ? <span className="error-text tiny">{error}</span> : null}
    </span>
  );
}

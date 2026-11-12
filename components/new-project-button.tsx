"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";

export function NewProjectButton({
  label = "New project",
  kind = "video",
  className = "btn btn-primary",
}: {
  label?: string;
  kind?: "video" | "image";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: kind === "image" ? "Untitled image" : "Untitled video" }),
      });
      const data = (await response.json().catch(() => ({}))) as { project?: { id: string }; error?: string };
      if (!response.ok || !data.project) {
        setError(data.error || "Could not create a project.");
        return;
      }
      router.push(`/studio/${data.project.id}${kind === "image" ? "?mode=image" : ""}`);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row wrap" style={{ gap: 8 }}>
      <button className={className} onClick={create} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}
        {busy ? "Creating…" : label}
      </button>
      {error ? <span className="error-text tiny">{error}</span> : null}
    </span>
  );
}

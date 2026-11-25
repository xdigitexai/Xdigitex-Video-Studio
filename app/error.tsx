"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Malaba Studio route error:", error);
  }, [error]);

  return (
    <div className="state-page">
      <div className="state-card">
        <div className="state-icon"><AlertTriangle size={24} /></div>
        <h1>This page could not be loaded</h1>
        <p>
          The request failed before the workspace could render. Your projects, credits and payment records are
          unchanged. Try again, or return to your dashboard.
        </p>
        {error.message ? <code className="state-detail">{error.message}</code> : null}
        <div className="state-actions">
          <button className="btn btn-primary" onClick={reset}><RefreshCw size={15} /> Try again</button>
          <Link href="/dashboard" className="btn btn-secondary"><ArrowLeft size={15} /> Dashboard</Link>
        </div>
      </div>
    </div>
  );
}

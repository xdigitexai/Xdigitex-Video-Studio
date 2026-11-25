"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, background: "#080B2E", color: "#F5F6FF", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 560, margin: "12vh auto", padding: 28, borderRadius: 18, border: "1px solid #2A2F5E", background: "#0E1238" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>Malaba Studio needs a restart</h1>
          <p style={{ color: "#AEB4D6", lineHeight: 1.6, fontSize: 14 }}>
            The application shell failed to initialise. No account data was changed.
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 12, padding: "11px 18px", borderRadius: 10, border: 0, cursor: "pointer", background: "#7017F5", color: "white", fontWeight: 600 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

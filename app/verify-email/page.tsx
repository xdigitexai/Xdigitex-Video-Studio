"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [token] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") || "",
  );
  const [state, setState] = useState<"working" | "done" | "error">(token ? "working" : "error");
  const [message, setMessage] = useState(
    token ? "Verifying your email address…" : "This verification link is missing its token.",
  );
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setState("error");
          setMessage(data.error || "Verification failed.");
          return;
        }
        setState("done");
        setMessage("Your email is verified. Welcome to Xdigitex Studio.");
        window.setTimeout(() => {
          router.push("/dashboard");
          router.refresh();
        }, 1400);
      } catch {
        setState("error");
        setMessage("Network error. Try the link again.");
      }
    })();
  }, [token, router]);

  return (
    <AuthShell
      title={state === "done" ? "You're verified" : state === "error" ? "Verification failed" : "Verifying"}
      subtitle="One moment while we activate your studio."
      footer={
        <>
          <Link href="/login">Sign in</Link>
          <Link href="/register">Create an account</Link>
        </>
      }
    >
      <div className={`notice ${state === "done" ? "notice-success" : state === "error" ? "notice-error" : "notice-info"}`}>
        {state === "working" ? <LoaderCircle className="spin" size={17} /> : null}
        {state === "done" ? <CheckCircle2 size={17} /> : null}
        {state === "error" ? <XCircle size={17} /> : null}
        {message}
      </div>
      {state === "done" ? (
        <Link href="/dashboard" className="btn btn-primary btn-block mt-2">
          Open my dashboard
        </Link>
      ) : null}
      {state === "error" ? (
        <Link href="/login" className="btn btn-secondary btn-block mt-2">
          Back to sign in
        </Link>
      ) : null}
    </AuthShell>
  );
}

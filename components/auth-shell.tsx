import Link from "next/link";
import { Brand } from "./brand";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <Brand href="/" />
        <div className="auth-quote">
          <div className="page-eyebrow">AI VIDEO &amp; IMAGE STUDIO</div>
          <h2>One studio for every idea you want to bring to life.</h2>
          <p>
            Generate cinematic clips and images with the world&apos;s leading AI models, edit them on a
            real timeline, and publish in minutes.
          </p>
        </div>
        <div className="row wrap" style={{ gap: 18, position: "relative", zIndex: 1 }}>
          <span className="badge badge-lime">Runway</span>
          <span className="badge badge-violet">OpenAI</span>
          <span className="badge badge-muted">Gemini</span>
          <span className="badge badge-muted">Kling</span>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
          {footer ? <div className="auth-links">{footer}</div> : null}
          <p className="tiny muted mt-4">
            By continuing you agree to the Xdigitex terms of service and acceptable use policy.
          </p>
          <p className="tiny muted mt-2">
            <Link href="/">← Back to the home page</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

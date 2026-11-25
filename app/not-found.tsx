import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="state-page">
      <div className="state-card">
        <div className="state-icon"><Compass size={24} /></div>
        <h1>We couldn&apos;t find that page</h1>
        <p>The link may be old, or the project may no longer be in your workspace.</p>
        <div className="state-actions">
          <Link href="/dashboard" className="btn btn-primary"><ArrowLeft size={15} /> Back to dashboard</Link>
          <Link href="/library" className="btn btn-secondary">Open media library</Link>
        </div>
      </div>
    </div>
  );
}

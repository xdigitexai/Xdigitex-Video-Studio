import Link from "next/link";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PasswordForm, ProfileForm } from "@/components/settings-forms";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { formatCredits, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const frame = await loadFrame("/settings");
  const { actor, entitlements, wallet } = frame;

  return (
    <AppShell
      active="settings"
      user={shellUser(actor)}
      availableCredits={wallet.available}
      planName={entitlements.plan?.name ?? null}
      title="Account settings"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">YOUR ACCOUNT</div>
          <h1 className="page-title">Account settings</h1>
          <p className="page-sub">Manage your profile, password and account security.</p>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <ProfileForm initialName={actor.user.display_name} email={actor.user.email} />
          <PasswordForm />
        </div>
        <aside className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Account</h3>
            </div>
            <div className="card-body stack">
              <div className="row-between">
                <span className="muted small">Role</span>
                <span className="badge badge-muted">{actor.user.role.replace("_", " ")}</span>
              </div>
              <div className="row-between">
                <span className="muted small">Email status</span>
                <span className={`badge ${actor.user.email_verified_at ? "badge-ok" : "badge-warn"}`}>
                  {actor.user.email_verified_at ? <><BadgeCheck size={11} /> Verified</> : "Unverified"}
                </span>
              </div>
              <div className="row-between">
                <span className="muted small">Member since</span>
                <span className="small">{formatDate(actor.user.created_at)}</span>
              </div>
              <div className="row-between">
                <span className="muted small">Plan</span>
                <span className="small">{entitlements.plan?.name ?? "None"}</span>
              </div>
              <div className="row-between">
                <span className="muted small">Credits</span>
                <span className="small">{formatCredits(wallet.balance)} total · {formatCredits(wallet.reserved)} reserved</span>
              </div>
              <Link href="/billing" className="btn btn-secondary btn-block mt-1">Manage billing</Link>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Security</h3>
            </div>
            <div className="card-body stack">
              <div className="row" style={{ alignItems: "flex-start", gap: 9 }}>
                <ShieldCheck size={16} style={{ color: "var(--lime)", marginTop: 2 }} />
                <p className="small muted">
                  Sessions are HttpOnly and expire after 30 days. All generation and billing operations are
                  authorized on the server for your account only.
                </p>
              </div>
              <p className="tiny muted">
                Need to close your account? Contact support from the email address on this account.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

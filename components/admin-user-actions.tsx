"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Save, ShieldAlert, Wallet } from "lucide-react";

export function UserAdminActions({
  userId,
  role,
  status,
  canManageRoles,
  plans,
}: {
  userId: string;
  role: string;
  status: string;
  canManageRoles: boolean;
  plans: Array<{ id: string; name: string; priceUsd: number; credits: number }>;
}) {
  const router = useRouter();
  const [nextRole, setNextRole] = useState(role);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [credits, setCredits] = useState("100");
  const [creditNote, setCreditNote] = useState("Support credit");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [months, setMonths] = useState("1");
  const [grantCredits, setGrantCredits] = useState(true);

  async function call(url: string, body: unknown, method = "PATCH") {
    setError("");
    setMessage("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; creditsGranted?: number };
      if (!response.ok) {
        setError(data.error || "Action failed.");
        return false;
      }
      setMessage("Saved.");
      router.refresh();
      return true;
    } catch {
      setError("Network error.");
      return false;
    }
  }

  return (
    <div className="stack">
      {error ? <div className="notice notice-error">{error}</div> : null}
      {message ? <div className="notice notice-success">{message}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Account access</h3>
            <p>Roles and suspension are enforced on every request.</p>
          </div>
          <ShieldAlert size={16} className="muted" />
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="role">Role</label>
              <select
                id="role"
                className="select"
                value={nextRole}
                onChange={(event) => setNextRole(event.target.value)}
                disabled={!canManageRoles}
              >
                <option value="customer">Customer</option>
                <option value="admin">Administrator</option>
                <option value="super_admin">Super administrator</option>
              </select>
              {!canManageRoles ? <span className="hint">Only a super administrator can change roles.</span> : null}
            </div>
            <div className="field">
              <label className="label" htmlFor="status">Account status</label>
              <select id="status" className="select" value={status} onChange={() => undefined} disabled>
                <option value={status}>{status}</option>
              </select>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy !== "" || nextRole === role}
              onClick={async () => {
                setBusy("role");
                await call(`/api/admin/users/${userId}`, { role: nextRole });
                setBusy("");
              }}
            >
              {busy === "role" ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />} Save role
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={busy !== ""}
              onClick={async () => {
                setBusy("status");
                await call(`/api/admin/users/${userId}`, { status: status === "active" ? "suspended" : "active" });
                setBusy("");
              }}
            >
              {busy === "status" ? <LoaderCircle className="spin" size={13} /> : null}
              {status === "active" ? "Suspend account" : "Reactivate account"}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Credit adjustment</h3>
            <p>Positive grants, or a negative correction limited by available credits.</p>
          </div>
          <Wallet size={16} className="muted" />
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="credits">Credits (+ / −)</label>
              <input id="credits" className="input" type="number" value={credits} onChange={(event) => setCredits(event.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="note">Reason</label>
              <input id="note" className="input" value={creditNote} onChange={(event) => setCreditNote(event.target.value)} maxLength={200} />
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("credits");
              await call(
                `/api/admin/users/${userId}/credits`,
                { credits: Number(credits), description: creditNote },
                "POST",
              );
              setBusy("");
            }}
          >
            {busy === "credits" ? <LoaderCircle className="spin" size={13} /> : <Wallet size={13} />} Apply adjustment
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Activate a plan</h3>
            <p>Support activation, comps or manual renewal. Fully audited.</p>
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="plan">Plan</label>
              <select id="plan" className="select" value={planId} onChange={(event) => setPlanId(event.target.value)}>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · ${plan.priceUsd.toFixed(0)} · {plan.credits} credits
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="months">Months</label>
              <input id="months" className="input" type="number" min={1} max={24} value={months} onChange={(event) => setMonths(event.target.value)} />
            </div>
          </div>
          <label className="checkbox mb-2">
            <input type="checkbox" checked={grantCredits} onChange={(event) => setGrantCredits(event.target.checked)} />
            <span>Grant the plan&apos;s monthly credits as promotional credits.</span>
          </label>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy !== "" || !planId}
            onClick={async () => {
              setBusy("plan");
              await call(
                `/api/admin/users/${userId}/subscription`,
                { planId, months: Number(months), grantCredits },
                "POST",
              );
              setBusy("");
            }}
          >
            {busy === "plan" ? <LoaderCircle className="spin" size={13} /> : null} Activate plan
          </button>
        </div>
      </div>
    </div>
  );
}

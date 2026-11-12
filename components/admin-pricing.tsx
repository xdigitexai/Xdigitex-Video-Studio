"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Save, Trash2, TrendingUp } from "lucide-react";

interface Option {
  id: string;
  name: string;
}

interface Override {
  id: string;
  label: string;
  user_id: string | null;
  plan_id: string | null;
  provider_id: string | null;
  model_id: string | null;
  generation_type: string | null;
  margin_bps: number | null;
  fixed_price_micros: number | null;
  min_charge_micros: number | null;
  priority: number;
  is_active: number;
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed.");
  return data;
}

export function AdminPricing({
  settings,
  overrides,
  users,
  plans,
  providers,
  models,
  preselectedUserId,
}: {
  settings: {
    defaultMarginBps: number;
    minChargeMicros: number;
    creditValueMicros: number;
    usdToKesRateMicros: number;
    gracePeriodDays: number;
    version: number;
  };
  overrides: Override[];
  users: Option[];
  plans: Array<Option & { code: string }>;
  providers: Array<Option & { code: string }>;
  models: Array<Option & { providerId: string }>;
  preselectedUserId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    margin: (settings.defaultMarginBps / 100).toFixed(2),
    minCharge: (settings.minChargeMicros / 1_000_000).toFixed(2),
    creditValue: (settings.creditValueMicros / 1_000_000).toFixed(4),
    kesRate: (settings.usdToKesRateMicros / 1_000_000).toFixed(2),
    graceDays: String(settings.gracePeriodDays),
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rule, setRule] = useState({
    label: "",
    userId: preselectedUserId ?? "",
    planId: "",
    providerId: "",
    modelId: "",
    generationType: "",
    margin: "40",
    fixed: "",
    minCharge: "",
    priority: "0",
  });

  const nameOf = (kind: "user" | "plan" | "provider" | "model", id: string | null): string => {
    if (!id) return "—";
    if (kind === "user") return users.find((option) => option.id === id)?.name ?? id;
    if (kind === "plan") return plans.find((option) => option.id === id)?.name ?? id;
    if (kind === "provider") return providers.find((option) => option.id === id)?.name ?? id;
    return models.find((option) => option.id === id)?.name ?? id;
  };

  async function saveSettings() {
    setBusy("settings");
    setError("");
    setMessage("");
    try {
      await send("/api/admin/pricing", "PUT", {
        defaultMarginBps: Math.round(Number(form.margin) * 100),
        minChargeMicros: Math.round(Number(form.minCharge) * 1_000_000),
        creditValueMicros: Math.round(Number(form.creditValue) * 1_000_000),
        usdToKesRateMicros: Math.round(Number(form.kesRate) * 1_000_000),
        gracePeriodDays: Number(form.graceDays),
      });
      setMessage("Pricing settings saved. New generations use the new version.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setBusy("");
    }
  }

  async function addRule() {
    setBusy("rule");
    setError("");
    setMessage("");
    try {
      await send("/api/admin/pricing/overrides", "POST", {
        label: rule.label || "Pricing rule",
        userId: rule.userId || null,
        planId: rule.planId || null,
        providerId: rule.providerId || null,
        modelId: rule.modelId || null,
        generationType: rule.generationType || null,
        marginBps: rule.margin ? Math.round(Number(rule.margin) * 100) : null,
        fixedPriceMicros: rule.fixed ? Math.round(Number(rule.fixed) * 1_000_000) : null,
        minChargeMicros: rule.minCharge ? Math.round(Number(rule.minCharge) * 1_000_000) : null,
        priority: Number(rule.priority) || 0,
      });
      setMessage("Pricing rule created.");
      setRule({ ...rule, label: "", fixed: "", minCharge: "" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the rule.");
    } finally {
      setBusy("");
    }
  }

  async function removeRule(id: string) {
    if (!window.confirm("Delete this pricing rule? Existing generation snapshots keep their original price.")) return;
    setBusy(id);
    setError("");
    try {
      await send(`/api/admin/pricing/overrides/${id}`, "DELETE");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the rule.");
    } finally {
      setBusy("");
    }
  }

  async function toggleRule(ruleRow: Override) {
    setBusy(ruleRow.id);
    try {
      await send(`/api/admin/pricing/overrides/${ruleRow.id}`, "PATCH", { isActive: ruleRow.is_active !== 1 });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the rule.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="split">
      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Global pricing</h3>
              <p>Selling price = provider cost ÷ (1 − margin). Never markup.</p>
            </div>
            <TrendingUp size={16} className="muted" />
          </div>
          <div className="card-body">
            {error ? <div className="notice notice-error mb-2">{error}</div> : null}
            {message ? <div className="notice notice-success mb-2">{message}</div> : null}
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="margin">Default gross margin (%)</label>
                <input id="margin" className="input" type="number" step="0.1" min={0} max={99} value={form.margin} onChange={(event) => setForm({ ...form, margin: event.target.value })} />
                <span className="hint">40% margin on a $0.80 cost sells at $1.34.</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="creditValue">Credit value (USD)</label>
                <input id="creditValue" className="input" type="number" step="0.0001" value={form.creditValue} onChange={(event) => setForm({ ...form, creditValue: event.target.value })} />
                <span className="hint">How much one credit is worth when pricing generations.</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="minCharge">Minimum customer charge (USD)</label>
                <input id="minCharge" className="input" type="number" step="0.01" value={form.minCharge} onChange={(event) => setForm({ ...form, minCharge: event.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="kesRate">USD → KES rate</label>
                <input id="kesRate" className="input" type="number" step="0.01" value={form.kesRate} onChange={(event) => setForm({ ...form, kesRate: event.target.value })} />
                <span className="hint">Used for M-Pesa checkout amounts.</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="grace">Grace period (days)</label>
                <input id="grace" className="input" type="number" min={0} max={60} value={form.graceDays} onChange={(event) => setForm({ ...form, graceDays: event.target.value })} />
              </div>
              <div className="field">
                <label className="label">Config version</label>
                <input className="input" value={settings.version} disabled />
              </div>
            </div>
            <button className="btn btn-primary" onClick={saveSettings} disabled={busy !== ""}>
              {busy === "settings" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Save pricing settings
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Pricing rules</h3>
              <p>Most specific rule wins: customer → model → provider → plan → generation type.</p>
            </div>
            <span className="badge badge-muted">{overrides.length} rules</span>
          </div>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="data" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Scope</th>
                  <th className="num">Margin</th>
                  <th className="num">Fixed</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overrides.map((override) => (
                  <tr key={override.id}>
                    <td>
                      <span className="strong">{override.label || "Unnamed rule"}</span>
                      {override.generation_type ? <div className="tiny muted">{override.generation_type.replace(/_/g, " ")}</div> : null}
                    </td>
                    <td className="tiny">
                      {override.user_id ? <div>Customer: {nameOf("user", override.user_id)}</div> : null}
                      {override.plan_id ? <div>Plan: {nameOf("plan", override.plan_id)}</div> : null}
                      {override.provider_id ? <div>Provider: {nameOf("provider", override.provider_id)}</div> : null}
                      {override.model_id ? <div>Model: {nameOf("model", override.model_id)}</div> : null}
                      {!override.user_id && !override.plan_id && !override.provider_id && !override.model_id && !override.generation_type ? "Global" : null}
                    </td>
                    <td className="num">{override.margin_bps !== null ? `${(override.margin_bps / 100).toFixed(1)}%` : "—"}</td>
                    <td className="num">{override.fixed_price_micros ? `$${(override.fixed_price_micros / 1_000_000).toFixed(2)}` : "—"}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleRule(override)} disabled={busy !== ""}>
                        <span className={`badge ${override.is_active ? "badge-ok" : "badge-muted"}`}>{override.is_active ? "on" : "off"}</span>
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => removeRule(override.id)} disabled={busy !== ""}>
                        {busy === override.id ? <LoaderCircle className="spin" size={12} /> : <Trash2 size={12} />}
                      </button>
                    </td>
                  </tr>
                ))}
                {!overrides.length ? (
                  <tr><td colSpan={6}><p className="muted small" style={{ padding: 12 }}>No overrides yet. The global margin applies to everyone.</p></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <aside className="stack">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>New pricing rule</h3>
              <p>Set a margin, a fixed price, or both.</p>
            </div>
            <Plus size={16} className="muted" />
          </div>
          <div className="card-body">
            <div className="field">
              <label className="label">Label</label>
              <input className="input" value={rule.label} onChange={(event) => setRule({ ...rule, label: event.target.value })} placeholder="VIP customer · 20%" />
            </div>
            <div className="field">
              <label className="label">Customer (optional)</label>
              <select className="select" value={rule.userId} onChange={(event) => setRule({ ...rule, userId: event.target.value })}>
                <option value="">All customers</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label">Plan</label>
                <select className="select" value={rule.planId} onChange={(event) => setRule({ ...rule, planId: event.target.value })}>
                  <option value="">Any plan</option>
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label">Provider</label>
                <select className="select" value={rule.providerId} onChange={(event) => setRule({ ...rule, providerId: event.target.value })}>
                  <option value="">Any provider</option>
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label">Model</label>
                <select className="select" value={rule.modelId} onChange={(event) => setRule({ ...rule, modelId: event.target.value })}>
                  <option value="">Any model</option>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label">Generation type</label>
                <select className="select" value={rule.generationType} onChange={(event) => setRule({ ...rule, generationType: event.target.value })}>
                  <option value="">Any type</option>
                  <option value="text_to_video">Text to video</option>
                  <option value="image_to_video">Image to video</option>
                  <option value="video_to_video">Video to video</option>
                  <option value="text_to_image">Text to image</option>
                  <option value="image_edit">Image edit</option>
                  <option value="transcription">Transcription</option>
                  <option value="prompt_enhance">Prompt enhancement</option>
                </select>
              </div>
              <div className="field">
                <label className="label">Margin (%)</label>
                <input className="input" type="number" step="0.1" value={rule.margin} onChange={(event) => setRule({ ...rule, margin: event.target.value })} />
              </div>
              <div className="field">
                <label className="label">Fixed price (USD)</label>
                <input className="input" type="number" step="0.01" value={rule.fixed} onChange={(event) => setRule({ ...rule, fixed: event.target.value })} placeholder="optional" />
              </div>
            </div>
            <div className="field">
              <label className="label">Minimum charge (USD, optional)</label>
              <input className="input" type="number" step="0.01" value={rule.minCharge} onChange={(event) => setRule({ ...rule, minCharge: event.target.value })} />
            </div>
            <button className="btn btn-primary btn-block" onClick={addRule} disabled={busy !== ""}>
              {busy === "rule" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Create rule
            </button>
            <p className="tiny muted mt-2">
              A 20% margin on a $0.80 provider cost sells at $1.00. A 55% margin sells at $1.78. Gross margin, not
              markup.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

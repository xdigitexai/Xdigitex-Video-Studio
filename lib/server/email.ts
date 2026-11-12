import type { Db } from "./db";
import { newId, now } from "./util";

export interface EmailConfig {
  resendApiKey?: string | null;
  from?: string | null;
  /** Xdigitex Mail HTTP API (mail.xdigitex.com/v1/emails). */
  mailApiUrl?: string | null;
  mailApiKey?: string | null;
  /** Local relay that ensures recipients and forwards to the mail API. */
  relayUrl?: string | null;
  relaySecret?: string | null;
}

export interface EmailInput {
  to: string;
  kind: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  id: string;
  delivered: boolean;
  error?: string;
}

function mailFrom(config: EmailConfig): string {
  return config.from || "VideoX <onboarding@xdigitex.com>";
}

async function sendViaXdigitexMail(config: EmailConfig, input: EmailInput): Promise<{ id?: string; error?: string }> {
  if (!config.mailApiUrl || !config.mailApiKey) {
    return { error: "Mail API is not configured." };
  }
  const response = await fetch(config.mailApiUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.mailApiKey}`,
      "content-type": "application/json",
      "idempotency-key": `videox-${input.kind}-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      to: [input.to],
      from: mailFrom(config),
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string; message?: string };
  if (!response.ok) {
    return { error: payload.message || payload.error || `Mail API rejected the message (${response.status}).` };
  }
  return { id: payload.id };
}

async function sendViaRelay(config: EmailConfig, input: EmailInput): Promise<{ id?: string; error?: string }> {
  if (!config.relayUrl) return { error: "Mail relay is not configured." };
  const response = await fetch(config.relayUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.relaySecret ? { "x-relay-secret": config.relaySecret } : {}),
    },
    body: JSON.stringify({
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!response.ok) {
    return { error: payload.error || `Mail relay rejected the message (${response.status}).` };
  }
  return { id: payload.id };
}

/**
 * Sends transactional email through the configured transport and persists every
 * attempt in the outbox. A message is only reported delivered when the
 * transport accepted it; `devMode` exposes the verification URL instead of
 * claiming delivery.
 */
export async function sendEmail(db: Db, input: EmailInput, config: EmailConfig): Promise<EmailResult> {
  const id = newId("mail");
  const timestamp = now();
  const recipient = input.to.trim().toLowerCase();
  await db.run(
    `INSERT INTO email_outbox (id, to_email, kind, subject, body, status, provider_message_id, error, created_at, sent_at)
     VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, NULL)`,
    [id, recipient, input.kind, input.subject.slice(0, 200), input.text, timestamp],
  );

  const transports: Array<() => Promise<{ id?: string; error?: string }>> = [];
  if (config.relayUrl) transports.push(() => sendViaRelay(config, input));
  else if (config.mailApiUrl && config.mailApiKey) transports.push(() => sendViaXdigitexMail(config, input));
  else if (config.resendApiKey && config.from) {
    transports.push(async () => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.resendApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: [recipient],
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) {
        return { error: payload.message || `Email provider rejected the message (${response.status}).` };
      }
      return { id: payload.id };
    });
  }

  if (!transports.length) {
    return { id, delivered: false };
  }

  for (const transport of transports) {
    try {
      const result = await transport();
      if (!result.error) {
        await db.run(
          `UPDATE email_outbox SET status = 'sent', provider_message_id = ?, sent_at = ? WHERE id = ?`,
          [result.id ?? null, now(), id],
        );
        return { id, delivered: true };
      }
      await db.run(`UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?`, [
        result.error.slice(0, 500),
        id,
      ]);
      return { id, delivered: false, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email transport failed.";
      await db.run(`UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?`, [
        message.slice(0, 500),
        id,
      ]);
      return { id, delivered: false, error: message };
    }
  }
  return { id, delivered: false };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

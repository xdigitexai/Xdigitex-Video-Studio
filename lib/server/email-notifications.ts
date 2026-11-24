import type { Db } from "./db";
import { sendEmail, type EmailConfig, type EmailResult } from "./email";
import type { RenderedEmail } from "./email-templates";
import type { RuntimeEnv } from "./runtime";
import { appBaseUrl } from "./runtime";

export function emailConfig(env: RuntimeEnv, request?: Request): EmailConfig {
  return {
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    appUrl: appBaseUrl(env, request),
    mailApiUrl: env.MAIL_API_URL,
    mailApiKey: env.MAIL_API_KEY,
    relayUrl: env.EMAIL_RELAY_URL,
    relaySecret: env.EMAIL_RELAY_SECRET,
  };
}

export async function sendRenderedEmail(
  db: Db,
  config: EmailConfig,
  to: string,
  kind: string,
  rendered: RenderedEmail,
): Promise<EmailResult> {
  return sendEmail(db, {
    to,
    kind,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  }, config);
}

/**
 * Notification emails must never interrupt an auth, billing or generation
 * workflow. Delivery errors are still audited by sendEmail() in the outbox.
 */
export async function trySendRenderedEmail(
  db: Db,
  config: EmailConfig,
  to: string,
  kind: string,
  rendered: RenderedEmail,
): Promise<EmailResult | null> {
  try {
    return await sendRenderedEmail(db, config, to, kind, rendered);
  } catch {
    return null;
  }
}

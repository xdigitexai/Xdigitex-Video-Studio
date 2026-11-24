export const EMAIL_BRAND = {
  name: "Malaba AI Studio",
  tagline: "Create. Edit. Inspire.",
  siteUrl: "https://malabavideoai.site",
  logoUrl: "https://malabavideoai.site/brand/malaba-ai-studio-logo.jpg",
  markUrl: "https://malabavideoai.site/brand/favicon.png",
  supportEmail: "support@malabavideoai.site",
  colors: {
    navy: "#080B2E",
    purple: "#7017F5",
    indigo: "#4425D9",
    blue: "#1677FF",
    orange: "#FF9D24",
    white: "#FFFFFF",
    soft: "#F5F6FF",
  },
} as const;

export type EmailKind =
  | "verify_email"
  | "welcome"
  | "reset_password"
  | "password_changed"
  | "new_login"
  | "security_alert"
  | "subscription_activated"
  | "payment_successful"
  | "payment_failed"
  | "subscription_expiring"
  | "subscription_cancelled"
  | "account_notification"
  | "video_completed"
  | "admin_promo"
  | "admin_billing"
  | "admin_other";

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailSection {
  heading?: string;
  body: string;
  bullets?: string[];
}

export interface EmailTemplateInput {
  kind: EmailKind;
  subject: string;
  title: string;
  intro: string;
  name?: string | null;
  preheader?: string;
  sections?: EmailSection[];
  details?: EmailDetail[];
  cta?: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  note?: string;
  siteUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value: string, siteUrl: string): string {
  try {
    const url = new URL(value, siteUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : siteUrl;
  } catch {
    return siteUrl;
  }
}

function formatDate(value: number | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatMoney(amount: number | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function greeting(name?: string | null): string {
  const clean = String(name || "").trim();
  return clean ? `Hello ${clean},` : "Hello,";
}

function renderHtml(input: EmailTemplateInput, siteUrl: string): string {
  const logo = escapeHtml(EMAIL_BRAND.logoUrl);
  const mark = escapeHtml(EMAIL_BRAND.markUrl);
  const cta = input.cta ? escapeHtml(safeUrl(input.cta.url, siteUrl)) : "";
  const secondary = input.secondaryCta ? escapeHtml(safeUrl(input.secondaryCta.url, siteUrl)) : "";
  const year = new Date().getUTCFullYear();

  const sections = (input.sections ?? [])
    .map((section) => {
      const heading = section.heading
        ? `<tr><td style="padding:18px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#080B2E;line-height:22px;">${escapeHtml(section.heading)}</td></tr>`
        : "";
      const bullets = section.bullets?.length
        ? `<ul style="margin:8px 0 0;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#41436A;">${section.bullets
            .map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`)
            .join("")}</ul>`
        : "";
      return `${heading}<tr><td style="padding:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#41436A;">${escapeHtml(section.body)}</td></tr>${bullets}`;
    })
    .join("");

  const details = input.details?.length
    ? `<tr><td style="padding:22px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#F5F6FF;border-radius:12px;"><tr><td style="padding:14px 18px;">${input.details
        .map(
          (detail) =>
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6E7096;width:38%;">${escapeHtml(detail.label)}</td><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:20px;color:#080B2E;text-align:right;word-break:break-word;">${escapeHtml(detail.value)}</td></tr></table>`,
        )
        .join("")}</td></tr></table></td></tr>`
    : "";

  const button = input.cta
    ? `<tr><td style="padding:28px 0 8px;"><table role="presentation" cellpadding="0" cellspacing="0" align="center" style="border-collapse:separate;"><tr><td align="center" bgcolor="#7017F5" style="border-radius:10px;background:#7017F5;"><a href="${cta}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(input.cta.label)}</a></td></tr></table></td></tr>`
    : "";

  const secondaryLink = input.secondaryCta
    ? `<tr><td align="center" style="padding:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6E7096;"><a href="${secondary}" style="color:#4425D9;text-decoration:underline;">${escapeHtml(input.secondaryCta.label)}</a></td></tr>`
    : "";

  const note = input.note
    ? `<tr><td style="padding:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#6E7096;">${escapeHtml(input.note)}</td></tr>`
    : "";

  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader || input.subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F6FF" style="background:#F5F6FF;margin:0;padding:0;">
<tr><td align="center" style="padding:28px 12px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
<tr><td bgcolor="#080B2E" style="background:#080B2E;padding:34px 24px 30px;border-radius:18px 18px 0 0;text-align:center;">
  <div style="max-width:420px;margin:0 auto;">
    <a href="${escapeHtml(safeUrl(siteUrl, siteUrl))}" style="text-decoration:none;"><img src="${logo}" width="420" height="280" alt="${escapeHtml(EMAIL_BRAND.name)}" style="display:block;width:100%;max-width:420px;height:auto;border:0;text-decoration:none;"></a>
  </div>
  <div style="padding:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:#B9A5FF;">${escapeHtml(EMAIL_BRAND.tagline)}</div>
</td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 24px;border-left:1px solid #E8EAFF;border-right:1px solid #E8EAFF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr><td style="padding:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#41436A;">${escapeHtml(greeting(input.name))}</td></tr>
  <tr><td class="mx-title" style="padding:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:700;line-height:38px;color:#080B2E;">${escapeHtml(input.title)}</td></tr>
  <tr><td class="mx-body" style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:25px;color:#41436A;">${escapeHtml(input.intro)}</td></tr>
  ${sections}
  ${details}
  ${button}
  ${secondaryLink}
  ${note}
  </table>
</td></tr>
<tr><td bgcolor="#F5F6FF" style="background:#F5F6FF;padding:26px 24px 30px;border:1px solid #E8EAFF;border-top:0;border-radius:0 0 18px 18px;text-align:center;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr><td style="padding:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#6E7096;">Need help? Reply to this email or contact <strong style="color:#4425D9;">${escapeHtml(EMAIL_BRAND.supportEmail)}</strong>.</td></tr>
  <tr><td style="padding:12px 0 0;border-top:1px solid #E1E4FA;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#8A8CB0;">© ${year} ${escapeHtml(EMAIL_BRAND.name)}. All rights reserved.<br>${escapeHtml(EMAIL_BRAND.tagline)} · <a href="${escapeHtml(safeUrl(siteUrl, siteUrl))}" style="color:#6E7096;text-decoration:underline;">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</a></td></tr>
  <tr><td style="padding:14px 0 0;"><img src="${mark}" width="34" height="34" alt="" style="display:block;margin:0 auto;width:34px;height:34px;border:0;"></td></tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>`;
}

function renderText(input: EmailTemplateInput, siteUrl: string): string {
  const lines: string[] = [
    EMAIL_BRAND.name,
    EMAIL_BRAND.tagline,
    "",
    greeting(input.name),
    "",
    input.title,
    "",
    input.intro,
  ];

  for (const section of input.sections ?? []) {
    lines.push("");
    if (section.heading) lines.push(section.heading.toUpperCase());
    lines.push(section.body);
    for (const bullet of section.bullets ?? []) lines.push(`- ${bullet}`);
  }

  if (input.details?.length) {
    lines.push("");
    for (const detail of input.details) lines.push(`${detail.label}: ${detail.value}`);
  }

  if (input.cta) {
    lines.push("");
    lines.push(`${input.cta.label}: ${safeUrl(input.cta.url, siteUrl)}`);
  }

  if (input.secondaryCta) {
    lines.push(`${input.secondaryCta.label}: ${safeUrl(input.secondaryCta.url, siteUrl)}`);
  }

  if (input.note) lines.push("", input.note);

  lines.push(
    "",
    "Need help? Contact " + EMAIL_BRAND.supportEmail,
    `Visit ${siteUrl}`,
    `© ${new Date().getUTCFullYear()} ${EMAIL_BRAND.name}. All rights reserved.`,
  );

  return lines.join("\n");
}

export function renderEmail(input: EmailTemplateInput): RenderedEmail {
  const siteUrl = (input.siteUrl || EMAIL_BRAND.siteUrl).replace(/\/$/, "");
  return {
    subject: input.subject,
    html: renderHtml(input, siteUrl),
    text: renderText(input, siteUrl),
  };
}

interface CommonTemplateOptions {
  name?: string | null;
  siteUrl?: string;
}

export function verificationEmail(options: CommonTemplateOptions & { url: string; expiresIn?: string }): RenderedEmail {
  return renderEmail({
    kind: "verify_email",
    subject: "Verify your Malaba AI Studio account",
    title: "Verify your email address",
    intro: "You're one step away from your creative workspace. Confirm your email address to activate your Malaba AI Studio account.",
    preheader: "Confirm your email to activate your workspace.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [{ label: "Link expires", value: options.expiresIn || "24 hours" }],
    cta: { label: "Verify my email", url: options.url },
    note: "If you didn't create this account, you can safely ignore this message. The link only works once and expires automatically.",
  });
}

export function welcomeEmail(options: CommonTemplateOptions): RenderedEmail {
  return renderEmail({
    kind: "welcome",
    subject: "Welcome to Malaba AI Studio",
    title: "Your studio is ready",
    intro: "Welcome to Malaba AI Studio. Create, edit and inspire — generate cinematic video and images, refine them in the same workspace, and export with confidence.",
    preheader: "Your creative workspace is ready.",
    name: options.name,
    siteUrl: options.siteUrl,
    sections: [
      {
        heading: "What you can do next",
        body: "Start with a prompt, choose a model, and preview the exact credit cost before you generate.",
        bullets: ["Generate video from text or an image", "Edit, caption and export in one place", "Track every credit and generation in your history"],
      },
    ],
    cta: { label: "Open my studio", url: `${options.siteUrl || EMAIL_BRAND.siteUrl}/studio` },
  });
}

export function resetPasswordEmail(options: CommonTemplateOptions & { url: string; expiresIn?: string }): RenderedEmail {
  return renderEmail({
    kind: "reset_password",
    subject: "Reset your Malaba AI Studio password",
    title: "Reset your password",
    intro: "We received a request to reset your Malaba AI Studio password. Use the secure button below to choose a new one.",
    preheader: "Your password reset link is ready.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [{ label: "Link expires", value: options.expiresIn || "60 minutes" }],
    cta: { label: "Choose a new password", url: options.url },
    note: "If you didn't request this reset, ignore this email. Your current password will keep working until you use the link.",
  });
}

export function passwordChangedEmail(options: CommonTemplateOptions & { url?: string }): RenderedEmail {
  return renderEmail({
    kind: "password_changed",
    subject: "Your Malaba AI Studio password was changed",
    title: "Password updated",
    intro: "Your Malaba AI Studio password was changed successfully. You can sign in with your new password.",
    preheader: "Your account password has been updated.",
    name: options.name,
    siteUrl: options.siteUrl,
    sections: [
      {
        heading: "Didn't make this change?",
        body: "If you didn't change your password, reset it immediately and review your account activity.",
      },
    ],
    cta: { label: "Reset my password", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/forgot-password` },
    note: "For your security, all existing sessions were signed out when the password changed.",
  });
}

export function newLoginEmail(
  options: CommonTemplateOptions & { ip?: string | null; device?: string | null; time?: number | null; url?: string },
): RenderedEmail {
  return renderEmail({
    kind: "new_login",
    subject: "New sign-in to your Malaba AI Studio account",
    title: "We noticed a new sign-in",
    intro: "Your Malaba AI Studio account was signed in from a device. If this was you, no action is needed.",
    preheader: "Check the details of your recent sign-in.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [
      { label: "When", value: formatDate(options.time ?? Date.now()) },
      { label: "IP address", value: options.ip || "Not available" },
      { label: "Device", value: (options.device || "Not available").slice(0, 120) },
    ],
    sections: [
      {
        heading: "Wasn't you?",
        body: "Change your password right away. This helps protect your workspace, credits and projects.",
      },
    ],
    cta: { label: "Secure my account", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/settings` },
  });
}

export function securityAlertEmail(
  options: CommonTemplateOptions & { message: string; url?: string; ctaLabel?: string },
): RenderedEmail {
  return renderEmail({
    kind: "security_alert",
    subject: "Important security notification from Malaba AI Studio",
    title: "Important security notification",
    intro: options.message,
    preheader: "An important update about your account security.",
    name: options.name,
    siteUrl: options.siteUrl,
    sections: [
      {
        heading: "What to do",
        body: "Review your account settings and update your password if you're unsure about this activity.",
      },
    ],
    cta: { label: options.ctaLabel || "Review account security", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/settings` },
  });
}

export function subscriptionActivatedEmail(
  options: CommonTemplateOptions & { plan: string; credits: number; periodEnd?: number | null; url?: string },
): RenderedEmail {
  return renderEmail({
    kind: "subscription_activated",
    subject: "Your Malaba AI Studio subscription is active",
    title: "Your subscription is active",
    intro: "Your Malaba AI Studio subscription is ready to use. Your plan credits have been added to your workspace.",
    preheader: "Your plan credits are ready.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [
      { label: "Plan", value: options.plan },
      { label: "Credits added", value: String(options.credits) },
      { label: "Current period ends", value: formatDate(options.periodEnd) },
    ],
    cta: { label: "Start creating", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/studio` },
  });
}

export function paymentSuccessfulEmail(
  options: CommonTemplateOptions & {
    amount?: number | null;
    currency?: string;
    reference: string;
    receipt?: string | null;
    purpose?: string;
    credits?: number;
    url?: string;
  },
): RenderedEmail {
  return renderEmail({
    kind: "payment_successful",
    subject: "Your Malaba AI Studio payment was successful",
    title: "Payment received",
    intro: "Thanks for your payment. Your Malaba AI Studio balance has been updated and the details are below.",
    preheader: "Your payment was received successfully.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [
      { label: "Amount", value: formatMoney(options.amount, options.currency || "KES") },
      { label: "Reference", value: options.reference },
      { label: "Receipt", value: options.receipt || "Pending" },
      ...(options.credits ? [{ label: "Credits", value: String(options.credits) }] : []),
    ],
    cta: { label: "View billing", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/billing` },
    note: options.purpose ? `Purpose: ${options.purpose.replace(/_/g, " ")}.` : undefined,
  });
}

export function paymentFailedEmail(
  options: CommonTemplateOptions & { amount?: number | null; currency?: string; reference: string; reason?: string | null; url?: string },
): RenderedEmail {
  return renderEmail({
    kind: "payment_failed",
    subject: "We couldn't complete your Malaba AI Studio payment",
    title: "Payment not completed",
    intro: "We couldn't confirm your latest payment. No credits or plan changes were applied for this transaction.",
    preheader: "Your payment needs attention.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [
      { label: "Amount", value: formatMoney(options.amount, options.currency || "KES") },
      { label: "Reference", value: options.reference },
      { label: "Status", value: options.reason || "Payment was not completed" },
    ],
    sections: [
      {
        heading: "What you can do",
        body: "Review your payment details and try again. If you were charged but don't see your credits, contact support with the reference above.",
      },
    ],
    cta: { label: "Review billing", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/billing` },
  });
}

export function subscriptionExpiringEmail(
  options: CommonTemplateOptions & { plan: string; expiry: number | null; url?: string },
): RenderedEmail {
  return renderEmail({
    kind: "subscription_expiring",
    subject: "Your Malaba AI Studio plan is expiring soon",
    title: "Your plan is expiring soon",
    intro: "Your Malaba AI Studio subscription is coming to an end. Renew now to keep creating without interruption.",
    preheader: "Renew your plan to keep your credits active.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [
      { label: "Plan", value: options.plan },
      { label: "Expires", value: formatDate(options.expiry) },
    ],
    cta: { label: "Renew my plan", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/billing` },
    note: "If your plan reaches the end of its grace period, unused subscription credits may expire.",
  });
}

export function subscriptionCancelledEmail(
  options: CommonTemplateOptions & { plan: string; effectiveDate?: number | null; url?: string },
): RenderedEmail {
  return renderEmail({
    kind: "subscription_cancelled",
    subject: "Your Malaba AI Studio subscription was cancelled",
    title: "Subscription cancelled",
    intro: "Your Malaba AI Studio subscription has been scheduled for cancellation. You can keep using your plan until the current period ends.",
    preheader: "Your cancellation has been scheduled.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [
      { label: "Plan", value: options.plan },
      { label: "Access until", value: formatDate(options.effectiveDate) },
    ],
    cta: { label: "Resume my plan", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/billing` },
    note: "You can resume your subscription at any time before the current period ends.",
  });
}

export function accountNotificationEmail(
  options: CommonTemplateOptions & { heading: string; message: string; ctaLabel?: string; url?: string },
): RenderedEmail {
  return renderEmail({
    kind: "account_notification",
    subject: options.heading,
    title: options.heading,
    intro: options.message,
    preheader: "An update about your Malaba AI Studio account.",
    name: options.name,
    siteUrl: options.siteUrl,
    cta: { label: options.ctaLabel || "Open my account", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/dashboard` },
  });
}

export function videoCompletedEmail(
  options: CommonTemplateOptions & { project: string; prompt: string; url?: string },
): RenderedEmail {
  return renderEmail({
    kind: "video_completed",
    subject: "Your Malaba AI Studio video is ready",
    title: "Your video is ready",
    intro: "Your generation finished successfully. Open your studio to preview, edit and export the result.",
    preheader: "Your latest generation is complete.",
    name: options.name,
    siteUrl: options.siteUrl,
    details: [
      { label: "Project", value: options.project },
      { label: "Prompt", value: options.prompt.slice(0, 120) },
    ],
    cta: { label: "View my video", url: options.url || `${options.siteUrl || EMAIL_BRAND.siteUrl}/studio` },
  });
}

export type AdminCategory = "promo" | "billing" | "other";

export function adminNotificationEmail(
  options: CommonTemplateOptions & { category: AdminCategory; subject: string; message: string },
): RenderedEmail {
  const titles: Record<AdminCategory, string> = {
    promo: "A special update for you",
    billing: "A note about your billing",
    other: "A message from Malaba AI Studio",
  };
  const preheaders: Record<AdminCategory, string> = {
    promo: "You have a new offer from Malaba AI Studio.",
    billing: "An important billing update is waiting for you.",
    other: "You have a new message from Malaba AI Studio.",
  };
  return renderEmail({
    kind: `admin_${options.category}` as EmailKind,
    subject: options.subject,
    title: titles[options.category],
    intro: options.message,
    preheader: preheaders[options.category],
    name: options.name,
    siteUrl: options.siteUrl,
    cta: { label: "Open my studio", url: `${options.siteUrl || EMAIL_BRAND.siteUrl}/dashboard` },
  });
}

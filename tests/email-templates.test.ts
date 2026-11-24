import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountNotificationEmail,
  adminNotificationEmail,
  newLoginEmail,
  passwordChangedEmail,
  paymentFailedEmail,
  paymentSuccessfulEmail,
  resetPasswordEmail,
  securityAlertEmail,
  subscriptionActivatedEmail,
  subscriptionCancelledEmail,
  subscriptionExpiringEmail,
  verificationEmail,
  videoCompletedEmail,
  welcomeEmail,
} from "../lib/server/email-templates";

const site = "https://malabavideoai.site";
const now = Date.now();

const templates = [
  verificationEmail({ name: "Creator", url: `${site}/verify-email?token=sample`, siteUrl: site }),
  welcomeEmail({ name: "Creator", siteUrl: site }),
  resetPasswordEmail({ name: "Creator", url: `${site}/reset-password?token=sample`, siteUrl: site }),
  passwordChangedEmail({ name: "Creator", siteUrl: site }),
  newLoginEmail({ name: "Creator", ip: "127.0.0.1", device: "Test browser", time: now, siteUrl: site }),
  securityAlertEmail({ name: "Creator", message: "Review your account.", siteUrl: site }),
  subscriptionActivatedEmail({ name: "Creator", plan: "Studio", credits: 100, periodEnd: now, siteUrl: site }),
  paymentSuccessfulEmail({
    name: "Creator",
    amount: 850,
    currency: "KES",
    reference: "TEST-1",
    receipt: "TESTRECEIPT",
    purpose: "subscription",
    credits: 100,
    siteUrl: site,
  }),
  paymentFailedEmail({ name: "Creator", amount: 850, currency: "KES", reference: "TEST-2", reason: "Cancelled", siteUrl: site }),
  subscriptionExpiringEmail({ name: "Creator", plan: "Studio", expiry: now + 86_400_000, siteUrl: site }),
  subscriptionCancelledEmail({ name: "Creator", plan: "Studio", effectiveDate: now + 86_400_000, siteUrl: site }),
  accountNotificationEmail({ name: "Creator", heading: "Account update", message: "Your account was updated.", siteUrl: site }),
  videoCompletedEmail({ name: "Creator", project: "Test project", prompt: "Golden hour over the reef", siteUrl: site }),
  adminNotificationEmail({ category: "promo", subject: "Promotion", message: "Try Studio.", siteUrl: site }),
  adminNotificationEmail({ category: "billing", subject: "Billing", message: "Invoice ready.", siteUrl: site }),
  adminNotificationEmail({ category: "other", subject: "Message", message: "Thank you.", siteUrl: site }),
];

test("every transactional template renders branded HTML and plain text", () => {
  assert.equal(templates.length, 16);
  for (const template of templates) {
    assert.ok(template.subject, "subject is present");
    assert.ok(template.html.includes("<table role=\"presentation\""), "table-based HTML is present");
    assert.ok(template.text.includes("Malaba AI Studio"), "plain text includes the brand");
    assert.ok(template.html.includes("Malaba AI Studio"), "HTML includes the brand");
    assert.ok(template.html.includes("Create. Edit. Inspire."), "HTML includes the tagline");
    assert.ok(template.html.includes("malaba-ai-studio-logo.jpg"), "HTML includes the hosted logo");
    assert.ok(!template.html.includes("@media"), "HTML has no embedded CSS that the relay would expose as text");
    assert.ok(!template.html.includes("<style"), "HTML has no style blocks");
    assert.ok(!template.html.includes("<title"), "HTML has no duplicated title text");
    assert.ok(!template.html.includes("undefined"), "HTML has no undefined values");
    assert.ok(!template.text.includes("undefined"), "plain text has no undefined values");
    assert.ok(template.html.includes("support@malabavideoai.site"), "HTML includes support contact");
    assert.ok(template.text.includes("support@malabavideoai.site"), "plain text includes support contact");
  }
});

test("template input is escaped in HTML output", () => {
  const template = accountNotificationEmail({
    name: '<script>alert("x")</script>',
    heading: "Account update",
    message: "<img src=x onerror=alert(1)>",
    siteUrl: site,
  });
  assert.ok(!template.html.includes("<script>"));
  assert.ok(!template.html.includes("<img src=x"));
  assert.ok(template.html.includes("&lt;script&gt;"));
});

test("authentication links are rendered in both bodies", () => {
  const verification = verificationEmail({ url: `${site}/verify-email?token=abc`, siteUrl: site });
  const reset = resetPasswordEmail({ url: `${site}/reset-password?token=abc`, siteUrl: site });
  for (const template of [verification, reset]) {
    assert.ok(template.html.includes("/verify-email?token=abc") || template.html.includes("/reset-password?token=abc"));
    assert.ok(template.text.includes("/verify-email?token=abc") || template.text.includes("/reset-password?token=abc"));
  }
});

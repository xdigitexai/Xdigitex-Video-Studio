import { findUserByEmail } from "@/lib/server/auth";
import type { UserRow } from "@/lib/server/auth-types";
import { auditRequest, guardMutation, requireAdmin } from "@/lib/server/context";
import { sendEmail } from "@/lib/server/email";
import { ApiError, errorResponse, json, readJson } from "@/lib/server/http";
import { appBaseUrl, type RuntimeEnv } from "@/lib/server/runtime";
import { isValidEmail, normalizeEmail, safeString } from "@/lib/server/util";

export const dynamic = "force-dynamic";

const CATEGORIES = ["promo", "billing", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const LABELS: Record<Category, string> = {
  promo: "Promotion",
  billing: "Billing reminder",
  other: "Message",
};

interface NotificationBody {
  userId?: string;
  email?: string;
  category?: string;
  subject?: string;
  message?: string;
}

function emailConfig(env: RuntimeEnv) {
  return {
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    mailApiUrl: env.MAIL_API_URL,
    mailApiKey: env.MAIL_API_KEY,
    relayUrl: env.EMAIL_RELAY_URL,
    relaySecret: env.EMAIL_RELAY_SECRET,
  };
}

export async function GET(request: Request) {
  try {
    const { db } = await requireAdmin(request);
    const entries = await db.all<{
      id: string;
      to_email: string;
      kind: string;
      subject: string;
      status: string;
      error: string | null;
      created_at: number;
    }>(
      `SELECT id, to_email, kind, subject, status, error, created_at
       FROM email_outbox WHERE kind LIKE 'admin_%' ORDER BY created_at DESC LIMIT 100`,
    );
    return json({ entries });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, env, actor } = await requireAdmin(request);
    await guardMutation(request, db, "admin-notification-send", 20, 60_000);
    const body = await readJson<NotificationBody>(request);

    const category = CATEGORIES.find((item) => item === body.category) as Category | undefined;
    if (!category) {
      throw new ApiError(400, "Choose a notification category.", "INVALID_CATEGORY");
    }
    const message = safeString(body.message, 4000);
    if (!message) throw new ApiError(400, "Message is required.", "INVALID_MESSAGE");

    const userId = safeString(body.userId, 100);
    const email = normalizeEmail(safeString(body.email, 254));
    let user: UserRow | null = null;
    if (userId) {
      user = await db.first<UserRow>(`SELECT * FROM users WHERE id = ? LIMIT 1`, [userId]);
    } else if (isValidEmail(email)) {
      user = await findUserByEmail(db, email);
    }
    if (!user) throw new ApiError(404, "Customer not found.", "USER_NOT_FOUND");

    const subject = safeString(body.subject, 140) || `${LABELS[category]} from Malaba Video AI`;
    const greeting = user.display_name ? `Hello ${user.display_name},` : "Hello,";
    const text = `${greeting}\n\n${message}\n\n— Malaba Video AI\n${appBaseUrl(env)}`;
    const result = await sendEmail(
      db,
      { to: user.email, kind: `admin_${category}`, subject, text },
      emailConfig(env),
    );

    await auditRequest(db, request, actor, "admin.notification_sent", "user", user.id, {
      category,
      subject,
      recipient: user.email,
      delivered: result.delivered,
      error: result.error ?? null,
      adminRole: actor.user.role,
    });

    if (!result.delivered) {
      return json({ ok: false, error: result.error || "Email delivery failed." }, 502);
    }
    return json({ ok: true, id: result.id, to: user.email, subject, category });
  } catch (error) {
    return errorResponse(error);
  }
}

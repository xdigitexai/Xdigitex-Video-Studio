/**
 * One-time, server-side owner bootstrap.
 *
 * Usage (on the application host, after migration 0006):
 *   ADMIN_BOOTSTRAP_EMAIL=owner@example.com ALLOW_ADMIN_BOOTSTRAP=1 \
 *     pnpm bootstrap:admin
 *
 * This command never creates a password and never accepts a role from an
 * HTTP request. It only promotes an already-registered account found in the
 * trusted local D1 database. Remove ALLOW_ADMIN_BOOTSTRAP after use.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const PERMISSIONS = [
  "admin.access", "users.read", "users.write", "users.roles",
  "plans.read", "plans.write", "providers.read", "providers.write",
  "models.read", "models.write", "pricing.read", "pricing.write",
  "payments.read", "payments.write", "notifications.read", "notifications.write",
  "audit.read", "export.read", "catalog.read",
];

const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Set ADMIN_BOOTSTRAP_EMAIL (or pass an email argument) to an existing registered account.");
  process.exit(1);
}
if (process.env.ALLOW_ADMIN_BOOTSTRAP !== "1") {
  console.error("Refusing to bootstrap: set ALLOW_ADMIN_BOOTSTRAP=1 on the server for this one-time command.");
  process.exit(1);
}

function findDatabase() {
  if (process.env.D1_DB_PATH) return resolve(process.env.D1_DB_PATH);
  const root = resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  if (!existsSync(root)) {
    console.error(`No local D1 database found at ${root}. Set D1_DB_PATH.`);
    process.exit(1);
  }
  const files = readdirSync(root)
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => join(root, name));
  if (files.length !== 1) {
    console.error(`Expected exactly one local D1 database, found ${files.length}. Set D1_DB_PATH.`);
    process.exit(1);
  }
  return files[0];
}

const databasePath = findDatabase();
const db = new DatabaseSync(databasePath);
const columns = db.prepare("PRAGMA table_info(users)").all().map((row) => row.name);
if (!columns.includes("mfa_enabled") || !columns.includes("mfa_secret")) {
  console.error("Migration 0006 has not been applied to this database. Apply migrations before bootstrapping.");
  process.exit(1);
}
const user = db
  .prepare("SELECT id, email, role FROM users WHERE email_normalized = ? LIMIT 1")
  .get(email);
if (!user) {
  console.error("No registered account matches ADMIN_BOOTSTRAP_EMAIL. Register normally first, then run this command.");
  process.exit(1);
}
const timestamp = Date.now();
db.prepare("UPDATE users SET role = 'super_admin', updated_at = ? WHERE id = ?").run(timestamp, user.id);
db.prepare(
  `INSERT INTO admin_permissions (user_id, permissions, created_at, updated_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at`,
).run(user.id, JSON.stringify(PERMISSIONS), timestamp, timestamp);
console.log(`Bootstrapped platform owner ${user.email} (${user.id}). No other accounts were changed.`);

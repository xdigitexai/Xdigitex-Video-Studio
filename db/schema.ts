import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Xdigitex Video Studio — multi-tenant SaaS schema.
 *
 * Conventions:
 * - Timestamps are Unix milliseconds (INTEGER).
 * - Money is stored in USD micro-units (1e-6 USD) unless the column says `_minor`
 *   (minor units of the payment currency, e.g. KES cents).
 * - Credits are whole integers. The credit value is configured centrally in
 *   `pricing_settings.credit_value_micros`.
 * - Every customer-owned row carries an explicit owner column. Tenant isolation is
 *   enforced in server code, never in the browser.
 */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull().default(""),
    role: text("role").notNull().default("customer"),
    status: text("status").notNull().default("active"),
    emailVerifiedAt: integer("email_verified_at"),
    legacyOwnerId: text("legacy_owner_id"),
    lastLoginAt: integer("last_login_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_email_normalized_unique").on(table.emailNormalized),
    uniqueIndex("users_legacy_owner_unique").on(table.legacyOwnerId),
    index("users_role_idx").on(table.role),
    index("users_created_idx").on(table.createdAt),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expires_idx").on(table.expiresAt)],
);

export const authTokens = sqliteTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_tokens_hash_unique").on(table.tokenHash),
    index("auth_tokens_user_kind_idx").on(table.userId, table.kind),
  ],
);

export const emailOutbox = sqliteTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    toEmail: text("to_email").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (table) => [index("email_outbox_status_idx").on(table.status, table.createdAt)],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    intervalMonths: integer("interval_months").notNull().default(1),
    creditsPerPeriod: integer("credits_per_period").notNull().default(0),
    videoLimit: integer("video_limit").notNull().default(0),
    imageLimit: integer("image_limit").notNull().default(0),
    maxVideoDurationSeconds: integer("max_video_duration_seconds").notNull().default(5),
    resolutions: text("resolutions").notNull().default('["720p"]'),
    queuePriority: integer("queue_priority").notNull().default(5),
    maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(1),
    storageLimitMb: integer("storage_limit_mb").notNull().default(2048),
    premiumFeatures: text("premium_features").notNull().default("[]"),
    isActive: integer("is_active").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("plans_code_unique").on(table.code), index("plans_active_idx").on(table.isActive, table.sortOrder)],
);

export const planModels = sqliteTable(
  "plan_models",
  {
    planId: text("plan_id").notNull(),
    modelId: text("model_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.planId, table.modelId] })],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    planId: text("plan_id").notNull(),
    status: text("status").notNull().default("active"),
    currentPeriodStart: integer("current_period_start").notNull(),
    currentPeriodEnd: integer("current_period_end").notNull(),
    cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
    graceEndsAt: integer("grace_ends_at"),
    pendingPlanId: text("pending_plan_id"),
    planChangeEffectiveAt: integer("plan_change_effective_at"),
    priceCentsSnapshot: integer("price_cents_snapshot").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    canceledAt: integer("canceled_at"),
  },
  (table) => [
    index("subscriptions_user_status_idx").on(table.userId, table.status),
    index("subscriptions_period_idx").on(table.status, table.currentPeriodEnd),
  ],
);

export const subscriptionEvents = sqliteTable(
  "subscription_events",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    detail: text("detail").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("subscription_events_sub_idx").on(table.subscriptionId, table.createdAt)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    reference: text("reference").notNull(),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull().default("xdigitex_pay"),
    planId: text("plan_id"),
    packageId: text("package_id"),
    subscriptionId: text("subscription_id"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("KES"),
    priceUsdCents: integer("price_usd_cents").notNull().default(0),
    credits: integer("credits").notNull().default(0),
    status: text("status").notNull().default("pending"),
    providerCheckoutId: text("provider_checkout_id"),
    providerReceipt: text("provider_receipt"),
    phoneNumber: text("phone_number"),
    failureReason: text("failure_reason"),
    fulfillmentError: text("fulfillment_error"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    refundedAt: integer("refunded_at"),
  },
  (table) => [
    uniqueIndex("payments_reference_unique").on(table.reference),
    index("payments_user_created_idx").on(table.userId, table.createdAt),
    index("payments_status_idx").on(table.status, table.createdAt),
    index("payments_checkout_idx").on(table.providerCheckoutId),
  ],
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id"),
    eventKey: text("event_key").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull().default("{}"),
    signatureValid: integer("signature_valid").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("payment_events_key_unique").on(table.eventKey),
    index("payment_events_payment_idx").on(table.paymentId, table.createdAt),
  ],
);

export const creditPackages = sqliteTable(
  "credit_packages",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    credits: integer("credits").notNull(),
    bonusCredits: integer("bonus_credits").notNull().default(0),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    isActive: integer("is_active").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("credit_packages_code_unique").on(table.code)],
);

export const creditWallets = sqliteTable("credit_wallets", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  lifetimePurchased: integer("lifetime_purchased").notNull().default(0),
  lifetimeGranted: integer("lifetime_granted").notNull().default(0),
  lifetimeConsumed: integer("lifetime_consumed").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const creditGrants = sqliteTable(
  "credit_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull().default(""),
    credits: integer("credits").notNull(),
    remaining: integer("remaining").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("credit_grants_user_idx").on(table.userId, table.status, table.expiresAt, table.createdAt)],
);

export const creditLedger = sqliteTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reference: text("reference").notNull(),
    generationId: text("generation_id"),
    paymentId: text("payment_id"),
    description: text("description").notNull().default(""),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("credit_ledger_reference_unique").on(table.reference),
    index("credit_ledger_user_idx").on(table.userId, table.createdAt),
    index("credit_ledger_generation_idx").on(table.generationId),
  ],
);

export const creditReservations = sqliteTable(
  "credit_reservations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    generationId: text("generation_id").notNull(),
    amount: integer("amount").notNull(),
    settledAmount: integer("settled_amount").notNull().default(0),
    status: text("status").notNull().default("held"),
    createdAt: integer("created_at").notNull(),
    settledAt: integer("settled_at"),
    releasedAt: integer("released_at"),
  },
  (table) => [
    uniqueIndex("credit_reservations_generation_unique").on(table.generationId),
    index("credit_reservations_user_idx").on(table.userId, table.status),
  ],
);

export const pricingSettings = sqliteTable("pricing_settings", {
  id: integer("id").primaryKey(),
  defaultMarginBps: integer("default_margin_bps").notNull().default(4000),
  minChargeMicros: integer("min_charge_micros").notNull().default(100000),
  creditValueMicros: integer("credit_value_micros").notNull().default(10000),
  usdToKesRateMicros: integer("usd_to_kes_rate_micros").notNull().default(130000000),
  gracePeriodDays: integer("grace_period_days").notNull().default(3),
  currency: text("currency").notNull().default("USD"),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

export const pricingOverrides = sqliteTable(
  "pricing_overrides",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull().default(""),
    userId: text("user_id"),
    planId: text("plan_id"),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    generationType: text("generation_type"),
    marginBps: integer("margin_bps"),
    fixedPriceMicros: integer("fixed_price_micros"),
    minChargeMicros: integer("min_charge_micros"),
    priority: integer("priority").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("pricing_overrides_lookup_idx").on(table.isActive, table.userId, table.modelId)],
);

export const aiProviders = sqliteTable(
  "ai_providers",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url"),
    isEnabled: integer("is_enabled").notNull().default(1),
    status: text("status").notNull().default("unconfigured"),
    lastCheckedAt: integer("last_checked_at"),
    lastError: text("last_error"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("ai_providers_code_unique").on(table.code)],
);

export const providerCredentials = sqliteTable(
  "provider_credentials",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    label: text("label").notNull().default("default"),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    fingerprint: text("fingerprint").notNull().default(""),
    isActive: integer("is_active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    rotatedAt: integer("rotated_at"),
    lastUsedAt: integer("last_used_at"),
  },
  (table) => [index("provider_credentials_provider_idx").on(table.providerId, table.isActive)],
);

export const aiModels = sqliteTable(
  "ai_models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull().default(""),
    capabilities: text("capabilities").notNull().default("[]"),
    pricingUnit: text("pricing_unit").notNull().default("per_request"),
    unitCostMicros: integer("unit_cost_micros").notNull().default(0),
    minChargeMicros: integer("min_charge_micros").notNull().default(0),
    pricingMeta: text("pricing_meta").notNull().default("{}"),
    maxDurationSeconds: integer("max_duration_seconds").notNull().default(10),
    resolutions: text("resolutions").notNull().default("[]"),
    isActive: integer("is_active").notNull().default(1),
    isDefaultVideo: integer("is_default_video").notNull().default(0),
    isDefaultImage: integer("is_default_image").notNull().default(0),
    isEstimated: integer("is_estimated").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_models_provider_code_unique").on(table.providerId, table.code),
    index("ai_models_active_idx").on(table.isActive, table.sortOrder),
  ],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull().default(""),
  aspect: text("aspect").notNull().default("16:9"),
  duration: integer("duration").notNull().default(5),
  trimStart: integer("trim_start").notNull().default(0),
  trimEnd: integer("trim_end").notNull().default(0),
  overlayTitle: text("overlay_title").notNull().default(""),
  selectedAssetId: text("selected_asset_id"),
  captionEnabled: integer("caption_enabled").notNull().default(1),
  captions: text("captions").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: text("owner_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  kind: text("kind").notNull().default("source"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("assets_project_created_idx").on(table.projectId, table.createdAt), index("assets_owner_idx").on(table.ownerId)]);

export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: text("owner_id").notNull(),
  providerTaskId: text("provider_task_id").notNull(),
  status: text("status").notNull(),
  mode: text("mode").notNull().default("generate"),
  prompt: text("prompt").notNull(),
  duration: integer("duration").notNull(),
  aspect: text("aspect").notNull(),
  outputAssetId: text("output_asset_id"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  capability: text("capability").notNull().default("text_to_video"),
  settings: text("settings").notNull().default("{}"),
  progress: integer("progress").notNull().default(0),
  creditsReserved: integer("credits_reserved").notNull().default(0),
  creditsCharged: integer("credits_charged").notNull().default(0),
  pricingSnapshotId: text("pricing_snapshot_id"),
  billingStatus: text("billing_status").notNull().default("none"),
  idempotencyKey: text("idempotency_key"),
  submittedAt: integer("submitted_at"),
  completedAt: integer("completed_at"),
  attempts: integer("attempts").notNull().default(0),
}, (table) => [
  index("generations_project_created_idx").on(table.projectId, table.createdAt),
  index("generations_owner_created_idx").on(table.ownerId, table.createdAt),
  index("generations_status_idx").on(table.status, table.createdAt),
  uniqueIndex("generations_idempotency_unique").on(table.idempotencyKey),
]);

export const pricingSnapshots = sqliteTable(
  "pricing_snapshots",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id").notNull(),
    userId: text("user_id").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    capability: text("capability").notNull(),
    units: integer("units").notNull().default(1),
    unitKind: text("unit_kind").notNull().default("request"),
    providerCostMicros: integer("provider_cost_micros").notNull(),
    marginBps: integer("margin_bps").notNull(),
    sellingPriceMicros: integer("selling_price_micros").notNull(),
    creditsCharged: integer("credits_charged").notNull(),
    creditValueMicros: integer("credit_value_micros").notNull(),
    currency: text("currency").notNull().default("USD"),
    estimated: integer("estimated").notNull().default(1),
    configVersion: integer("config_version").notNull().default(1),
    appliedRule: text("applied_rule").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("pricing_snapshots_generation_unique").on(table.generationId),
    index("pricing_snapshots_user_idx").on(table.userId, table.createdAt),
  ],
);

export const generationUsage = sqliteTable(
  "generation_usage",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    units: integer("units").notNull().default(1),
    unitKind: text("unit_kind").notNull().default("request"),
    estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
    actualCostMicros: integer("actual_cost_micros"),
    providerReference: text("provider_reference"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("generation_usage_generation_idx").on(table.generationId), index("generation_usage_provider_idx").on(table.providerId, table.createdAt)],
);

export const providerErrorEvents = sqliteTable(
  "provider_error_events",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    generationId: text("generation_id"),
    httpStatus: integer("http_status"),
    code: text("code"),
    message: text("message").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("provider_errors_provider_idx").on(table.providerId, table.createdAt)],
);

export const apiRateLimits = sqliteTable(
  "api_rate_limits",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull().default(""),
    targetId: text("target_id").notNull().default(""),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_created_idx").on(table.createdAt),
    index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
  ],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

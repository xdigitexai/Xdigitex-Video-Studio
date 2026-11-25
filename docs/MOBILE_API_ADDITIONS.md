# Backend additions for the native mobile client

These are the only backend changes required by the Flutter app. They were documented here **before** implementation.

## 1. `GET /api/plans`

- Auth: existing `xdg_session` cookie (`requireUser`).
- Returns active subscription plans using the existing `listPlans()` + `toPlanView()` helpers.
- Response: `{ "plans": PlanView[] }`.
- Read-only; no website UI or payment behavior changes.

## 2. `GET /api/credit-packages`

- Auth: existing `xdg_session` cookie.
- Returns active credit packages from the existing `credit_packages` table.
- Response: `{ "packages": [{ id, code, name, credits, bonusCredits, priceCents, currency, isActive, sortOrder }] }`.
- Read-only; checkout still uses the existing `/api/billing/checkout`.

## 3. `GET /api/usage`

- Auth: existing `xdg_session` cookie.
- Returns the existing `Entitlements.limits` and `Entitlements.usage` already calculated by `getEntitlements()`.
- Response: `{ "limits": { ... }, "usage": { ... }, "status": "...", "periodEnd": ... }`.
- Read-only; makes existing plan limits visible to the mobile app without duplicating logic.

Nothing else is added. Authentication, credits, payments, providers, media, and generation continue to use the existing endpoints and database.

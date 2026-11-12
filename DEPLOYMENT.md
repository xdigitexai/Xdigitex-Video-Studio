# VideoX deployment — server 161 (platform.novaspack.com)

Live: **https://video.xdigitex.com** · PM2 app `videox` · mail relay `videox-mail-relay`

## Layout on the server
| Path | Purpose |
| --- | --- |
| `/opt/videox/app` | Source checkout (git worktree of `/opt/videox/git/videox.git`) |
| `/opt/videox/app/.dev.vars` | Production secrets (copied to `dist/server/.dev.vars` after each build) |
| `/opt/videox/ecosystem.config.cjs` | PM2 definitions (videox on 127.0.0.1:8890, mail relay on 8892) |
| `/opt/videox/mail-relay.mjs` | HTTP→Xdigitex Mail bridge (marks recipients verified, forwards to `/v1/emails`) |
| `/opt/videox/logs/` | PM2 stdout/stderr |
| `/etc/nginx/sites-available/videox{,-ssl}` | vhosts (port 80 + ACME, then 443) |
| `.wrangler/state/v3/d1/.../*.sqlite` | Persistent local D1 (migrations applied manually, see below) |
| `.wrangler/state/v3/r2/...` | Persistent local R2 (uploaded media) |

## Runtime model
The app is a Cloudflare Workers (Vinext) build. On this server it runs under
`wrangler dev --local --persist-to .wrangler/state` — Miniflare simulates D1
(SQLite files) and R2 (local bucket) with full persistence, behind nginx with
Let's Encrypt. This is the framework's own `npm start` path, self-hosted.

> Production-grade Cloudflare note: the same `dist/` deploys to Cloudflare
> Workers via the Sites pipeline (`.openai/hosting.json`) or `wrangler deploy`
> with a Cloudflare API token. The code needs no changes; only bindings
> (D1/R2) and secrets must exist on the account.

## Deploy / update procedure
```sh
# local
git push deploy main
# server
git --git-dir=/opt/videox/git/videox.git --work-tree=/opt/videox/app checkout -f main
cd /opt/videox/app
npm run build
cp .dev.vars dist/server/.dev.vars
pm2 restart videox
```

### After a fresh checkout that added migrations
```sh
DB=/opt/videox/app/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
pm2 stop videox
for f in /opt/videox/app/drizzle/000*.sql; do sqlite3 "$DB" < "$f"; done
pm2 start videox
```
Find the DB hash with: `find /opt/videox/app/.wrangler/state/v3/d1 -name '*.sqlite'`

## Backup
The entire business state lives in two places (back both):
```sh
tar czf /root/backups/videox-state-$(date +%F).tgz \
  /opt/videox/app/.wrangler/state /opt/videox/app/.dev.vars
```
R2 media files are under `.wrangler/state/v3/r2/miniflare-R2BucketObject/`.

## Cron
`*/5 * * * * /opt/videox/cron.sh` — hits `/api/cron?secret=…` for payment
reconciliation and stuck-generation sweeps.

## Payments (Pay Xdigitex)
- Gateway API key `sk_videox_…` and webhook `whsec_…` live in the pay portal's
  Postgres (`api_keys` / `webhooks` tables, user 2) and in `.dev.vars`.
- Webhook URL: `https://video.xdigitex.com/api/webhooks/xdigitex-pay`
  (HMAC-SHA256 of the raw body, `X-Webhook-Signature` header).
- Never treat a checkout redirect as payment — only gateway status/webhook.
- Live M-Pesa pushes are real money. Test with the portal's sandbox mode or a
  1 KES push before going live.

## Email (Xdigitex Mail)
- Relay on 127.0.0.1:8892 → `https://mail.xdigitex.com/v1/emails` (API key
  `xm_…`, account Digitex254).
- Until the `xdigitex.com` domain is verified in the Xdigitex Mail dashboard,
  messages go out in sandbox mode (footer note) and recipients are marked
  verified locally by the relay so delivery is not blocked.
- Remove the sandbox footer: verify `xdigitex.com` in mail.xdigitex.com
  (add the DNS TXT at the registrar, name.com).

## First admin
Register on the site with an email listed in `ADMIN_EMAILS`. That account is
created as **super administrator** and unlocks `/admin`.

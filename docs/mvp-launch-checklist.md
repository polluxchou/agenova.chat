# Agenova MVP — Online Setup Checklist

**Domain:** agenova.chat (owned)
**Hosted API target:** api.agenova.chat
**Mailbox domain:** @agenova.chat

Work through each section in order. Each step is blocked by the one before it.

---

## Step 1 — Choose & Sign Up for an Email Provider

You need **one provider for inbound** (receiving email) and **one for outbound** (sending email).
The simplest path is to use **Resend** for outbound and **Cloudflare Email Routing** for inbound —
both have generous free tiers.

### Option A — Recommended (simplest)

| Role | Provider | Cost | Sign-up URL |
|---|---|---|---|
| Inbound (MX) | Cloudflare Email Routing | Free | Already in your Cloudflare account |
| Outbound (SMTP/API) | Resend | Free up to 3 000/mo | https://resend.com/signup |

### Option B — Single provider for both

| Provider | Notes |
|---|---|
| Mailgun | $35/mo Flex, handles inbound + outbound |
| Postmark | $15/mo, excellent deliverability |

**Decision required:** Pick your providers before continuing. The rest of this checklist
uses **Resend + Cloudflare Email Routing** (Option A).

---

## Step 2 — Point agenova.chat DNS to Cloudflare (if not already)

> Skip this step if agenova.chat is already on Cloudflare.

1. Log in to your domain registrar (where you bought agenova.chat)
2. Change the nameservers to Cloudflare's:
   - `nico.ns.cloudflare.com`
   - `ruby.ns.cloudflare.com`
   (Cloudflare gives you the exact values when you add the site)
3. Wait for propagation — usually under 30 minutes

---

## Step 3 — Configure Inbound Email (Cloudflare Email Routing)

This makes everything sent to `*@agenova.chat` reach your hosted server webhook.

1. In Cloudflare → **Email** → **Email Routing** → enable for agenova.chat
2. Go to **Routing rules** → **Catch-all address** → set action to **Send to Worker**
3. Create a new Email Worker (or use the HTTP forward option):
   - Forward to: `https://api.agenova.chat/v1/webhook/inbound`
   - Method: POST
   - Format: Cloudflare's `Email` event → your worker translates it to the webhook payload format

   > **Alternatively:** if using Mailgun for inbound, skip the Cloudflare worker —
   > set MX records to Mailgun and configure Mailgun's inbound route to forward to
   > `https://api.agenova.chat/v1/webhook/inbound`.

4. Cloudflare automatically adds the **MX records** for you — verify they appear:

   ```
   agenova.chat.  MX  10  route1.mx.cloudflare.net
   agenova.chat.  MX  20  route2.mx.cloudflare.net
   agenova.chat.  MX  50  route3.mx.cloudflare.net
   ```

---

## Step 4 — Set Up Resend (Outbound Email)

1. Sign up at https://resend.com/signup
2. Go to **Domains** → **Add domain** → enter `agenova.chat`
3. Resend shows you DNS records to add — add them all in Cloudflare:

   | Type | Name | Value |
   |---|---|---|
   | TXT | `resend._domainkey.agenova.chat` | `p=...` (DKIM key from Resend) |
   | TXT | `agenova.chat` | `v=spf1 include:amazonses.com ~all` (SPF — Resend provides exact value) |
   | TXT | `_dmarc.agenova.chat` | `v=DMARC1; p=none; rua=mailto:dmarc@agenova.chat` |

4. Click **Verify** in Resend — wait for green checkmarks (can take up to 1 hour)
5. Go to **API Keys** → **Create API Key** → copy the key (starts with `re_...`)
   - **Label:** `agenova-hosted-prod`
   - **Permissions:** Full access (or Sending access only)
   - Save this key — you'll need it in Step 6

---

## Step 5 — Deploy the Hosted Server

Deploy `packages/hosted/` to any server that can run Bun.

### Option A — Fly.io (recommended, free tier available)

```bash
# From packages/hosted/
fly launch --name agenova-hosted --region sin   # pick region closest to you
fly volumes create hosted_data --size 1         # persistent volume for SQLite
```

Create `fly.toml` in `packages/hosted/`:
```toml
app = "agenova-hosted"
primary_region = "sin"

[build]
  # Fly auto-detects Bun

[mounts]
  source = "hosted_data"
  destination = "/data"

[env]
  PORT = "3100"
  AGENOVA_HOSTED_DB_PATH = "/data/hosted.db"
  AGENOVA_MAILBOX_DOMAIN = "agenova.chat"

[[services]]
  internal_port = 3100
  protocol = "tcp"

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.ports]]
    port = 80
    handlers = ["http"]
```

```bash
fly deploy
```

### Option B — Railway

1. Create a new project → Deploy from GitHub repo
2. Set root directory to `packages/hosted`
3. Railway auto-detects Bun and runs `bun run src/index.ts`
4. Add a persistent volume and set `AGENOVA_HOSTED_DB_PATH=/data/hosted.db`

### Option C — Any Linux VPS (DigitalOcean, Hetzner, etc.)

```bash
# On the server
curl -fsSL https://bun.sh/install | bash
git clone <your-repo>
cd agenova/packages/hosted
bun install
bun run src/index.ts   # use PM2 or systemd to keep it running
```

---

## Step 6 — Set Environment Variables on the Hosted Server

Set these in your hosting platform's dashboard (Fly secrets, Railway variables, `.env` file, etc.):

| Variable | Value | Required |
|---|---|---|
| `PORT` | `3100` | Yes |
| `AGENOVA_HOSTED_DB_PATH` | `/data/hosted.db` (or wherever your volume is) | Yes |
| `AGENOVA_MAILBOX_DOMAIN` | `agenova.chat` | Yes |
| `AGENOVA_EMAIL_PROVIDER` | `resend` | Yes |
| `RESEND_API_KEY` | `re_...` (from Step 4) | Yes |
| `AGENOVA_WEBHOOK_SECRET` | any random string (32+ chars) | Recommended |
| `AGENOVA_CLEANUP_INTERVAL_MS` | `600000` (10 min, default) | Optional |
| `AGENOVA_DELIVERY_INTERVAL_MS` | `30000` (30 sec, default) | Optional |
| `AGENOVA_DELIVERY_BATCH_SIZE` | `10` (default) | Optional |

**For Fly.io:**
```bash
fly secrets set AGENOVA_EMAIL_PROVIDER=resend
fly secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
fly secrets set AGENOVA_MAILBOX_DOMAIN=agenova.chat
fly secrets set AGENOVA_WEBHOOK_SECRET=your-random-secret-here
```

---

## Step 7 — Point api.agenova.chat DNS to Your Server

In Cloudflare DNS → add an A record:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `api` | `<your server IP>` | Proxied (orange cloud) ✓ |

> If using Fly.io, use their provided IP or CNAME instead of a bare IP.
> Run `fly ips list` to get the IP address.

After adding the record, verify:
```bash
curl https://api.agenova.chat/health
# Expected: {"status":"ok"}
```

---

## Step 8 — Provision Your First API Token

SSH into (or run locally against) the hosted DB:

```bash
# On the server, from packages/hosted/
bun run provision-token "local-server-prod"
```

You'll see output like:
```
[provision] Using DB: /data/hosted.db
[provision] Label:    local-server-prod
[provision] Token stored (SHA-256: a3f9...)
[provision] Copy the token below into your local server's AGENOVA_API_TOKEN env var:

agt_8f3a2b...64-char-hex...
```

Copy the `agt_...` token. Set it on your **local server** (not the hosted server):

```bash
# In your local server's environment
AGENOVA_API_TOKEN=agt_8f3a2b...
AGENOVA_HOSTED_URL=https://api.agenova.chat
```

---

## Step 9 — Configure the Webhook Secret (if you set one in Step 6)

If you set `AGENOVA_WEBHOOK_SECRET` in Step 6, configure your email provider
to send that same secret in the `X-Webhook-Secret` header with every inbound POST.

- **Cloudflare Worker:** Add `request.headers.set('X-Webhook-Secret', 'your-secret')` before forwarding
- **Mailgun:** Set in Mailgun's route configuration as a custom header

---

## Step 10 — Smoke Test End-to-End

Run through these checks in order:

### 10a — Health check
```bash
curl https://api.agenova.chat/health
# → {"status":"ok"}
```

### 10b — Claim a mailbox from your local server
```bash
# Using your local server's HTTP API
curl -X POST http://localhost:3000/v1/agents/<agent-id>/mailbox/claim \
  -H "Authorization: Bearer <local-token>" \
  -H "Content-Type: application/json" \
  -d '{"handle": "testuser"}'
# → {"hosted_mailbox": "testuser@agenova.chat", "claim_id": "..."}
```

### 10c — Send a test email to testuser@agenova.chat
Use any email client or:
```bash
# Send from your personal email to testuser@agenova.chat
# Wait ~30 seconds, then check the local server inbox:
curl http://localhost:3000/v1/agents/<agent-id>/mail/inbox \
  -H "Authorization: Bearer <local-token>"
# → {"emails": [...]}
```

### 10d — Send an outbound email
```bash
curl -X POST http://localhost:3000/v1/mail/send \
  -H "Authorization: Bearer <local-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "<agent-id>",
    "to": ["your-personal-email@example.com"],
    "subject": "Agenova MVP Test",
    "text": "Hello from Agenova!"
  }'
# Check your personal inbox — should arrive within 60 seconds
```

---

## Summary

| Step | Task | Time estimate |
|---|---|---|
| 1 | Sign up for Resend | 5 min |
| 2 | Point domain to Cloudflare | 0 min (if already done) |
| 3 | Configure Cloudflare Email Routing | 15 min |
| 4 | Add Resend DNS records + verify | 10 min + up to 1 hr propagation |
| 5 | Deploy hosted server | 20 min |
| 6 | Set environment variables | 5 min |
| 7 | Add `api` DNS A record | 5 min |
| 8 | Provision first API token | 2 min |
| 9 | Set webhook secret | 5 min |
| 10 | Smoke test | 10 min |

**Total hands-on time:** ~1–1.5 hours (plus DNS propagation waiting time)

---

## Quick Reference — All Env Vars

### Hosted server (`packages/hosted/`)
```
PORT=3100
AGENOVA_HOSTED_DB_PATH=/data/hosted.db
AGENOVA_MAILBOX_DOMAIN=agenova.chat
AGENOVA_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
AGENOVA_WEBHOOK_SECRET=<random 32+ char string>
```

### Local server (`packages/server/`)
```
AGENOVA_HOSTED_URL=https://api.agenova.chat
AGENOVA_API_TOKEN=agt_xxxxxxxxxxxx    ← from provision-token script
AGENOVA_MAILBOX_DOMAIN=agenova.chat
```

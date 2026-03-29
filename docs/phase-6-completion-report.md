# Phase 6 Completion Report — Hosted API Server & Integration

**Project:** Agenova Hosted Coordination Service
**Phase:** 6 — Hosted Integration (Code-Complete)
**Status:** Complete (code-complete; deployment pending domain/infrastructure setup)
**Hosted Test Result (confirmed):** 34 tests, 0 failures across 5 files, 189ms (bun test v1.3.11)
**Local Server Baseline Preserved (confirmed):** 204 tests, 0 failures across 16 files
**Combined total:** 238 tests, 0 failures

---

## 1. Summary

Phase 6 implemented the complete hosted API server (`packages/hosted/`) that will run at `api.agenova.chat`. The server implements all five API endpoints that the local server already calls (claim init/verify, release, inbox, send), plus a webhook inbound endpoint for receiving email from providers. A full end-to-end integration test suite validates the local server talking to the real hosted server implementation — proving the claim, sync, and send pipelines work against production-equivalent logic. No mock services are used in the E2E tests.

---

## 2. Scope Covered

Phase 6 scope per the Phase 6 proposal:

- Build the hosted API server implementing all five required endpoints
- Add webhook inbound endpoint for email provider integration
- Write unit tests for each hosted route
- Write cross-server E2E integration tests (local server ↔ hosted server)
- Validate claim, sync, and send flows against real hosted logic

---

## 3. What Is Completed (Confirmed)

### New package: `packages/hosted/`

| File | Purpose |
|---|---|
| `package.json` | Bun runtime, Hono dependency |
| `tsconfig.json` | ESNext, bundler module resolution, bun-types |
| `src/index.ts` | Server entry point, port 3100, startup logging |
| `src/app.ts` | `createApp()` factory — testable Hono app |
| `src/db/schema.ts` | 5-table schema: mailbox_claims, claim_challenges, emails, outbound_queue, api_tokens |
| `src/db/client.ts` | Singleton DB with `_createTestDb()` and `_resetDb()` test hooks |
| `src/crypto.ts` | Ed25519 `verifySignature()`, `sha256()`, `randomUuid()` |
| `src/middleware/auth.ts` | Bearer token auth — checks SHA-256(token) against api_tokens; dev token env var shortcut |
| `src/routes/claim.ts` | `POST /v1/mailbox/claim/init`, `POST /v1/mailbox/claim/verify`, `POST /v1/mailbox/release` |
| `src/routes/inbox.ts` | `GET /v1/inbox?mailbox=&since=&limit=` — serves emails to local servers |
| `src/routes/send.ts` | `POST /v1/send` — queues outbound email for delivery |
| `src/routes/webhook.ts` | `POST /v1/webhook/inbound` — receives email from providers (Mailgun, Cloudflare, etc.) |

### API endpoints (contract matches local server's client expectations)

| Endpoint | Method | Auth | Request | Response |
|---|---|---|---|---|
| `/v1/mailbox/claim/init` | POST | None | `{ agent_id, handle, public_key }` | `{ claim_id, challenge }` |
| `/v1/mailbox/claim/verify` | POST | None | `{ claim_id, signature }` | `{ hosted_mailbox }` |
| `/v1/mailbox/release` | POST | None | `{ agent_id, hosted_mailbox, challenge?, signature? }` | `{ ok: true }` |
| `/v1/inbox` | GET | Bearer | `?mailbox=&since=&limit=` | `{ emails: RemoteEmail[] }` |
| `/v1/send` | POST | Bearer | `{ from, to[], subject, text?, html? }` | `{ id }` |
| `/v1/webhook/inbound` | POST | Webhook secret | `{ from_address, to_address, subject?, body_text? }` | `{ id, mailbox }` |
| `/health` | GET | None | — | `{ status: 'ok' }` |

### Hosted DB schema

| Table | Rows | Purpose |
|---|---|---|
| `mailbox_claims` | handle (PK), hosted_mailbox (UNIQUE), agent_id, public_key, status, timestamps | Active claim bindings |
| `claim_challenges` | claim_id (PK), handle, challenge, status, expires_at | 5-minute TTL challenges for claim verification |
| `emails` | id (PK), mailbox, from/to, subject, body, message_id, timestamps | Inbound emails stored via webhook |
| `outbound_queue` | id (PK), from_mailbox, to_addresses (JSON), status, timestamps | Queued outbound emails for delivery |
| `api_tokens` | token_hash (PK), label, status | Bearer token authentication (SHA-256 hashed) |

### Security features

- **Ed25519 challenge/verify for claims**: The hosted server never stores private keys. It verifies signatures against the public key submitted during init.
- **5-minute challenge TTL**: Claim challenges expire and are marked as such. Replay is prevented.
- **Race condition guard**: Double-check uniqueness during verify (handles parallel claim attempts).
- **Upsert on re-claim**: A released handle can be re-claimed by a new agent via `ON CONFLICT DO UPDATE`.
- **Bearer token auth**: Inbox and send endpoints require a valid token. Tokens are stored as SHA-256 hashes.
- **Webhook secret**: Optional `AGENOVA_WEBHOOK_SECRET` env var for authenticating inbound webhooks.
- **Dev token shortcut**: `AGENOVA_DEV_TOKEN` env var bypasses DB lookup for development.

### Test files (34 tests total)

**`test/claim.test.ts` — 11 tests:**

| Test | Status |
|---|---|
| Init returns claim_id and challenge | Pass |
| Init rejects missing fields | Pass |
| Init rejects invalid handle format | Pass |
| Init returns 409 for taken handle | Pass |
| Full flow: init → verify → mailbox bound in DB | Pass |
| Verify rejects wrong signature (403) | Pass |
| Verify rejects unknown claim_id | Pass |
| Verify rejects already-used challenge | Pass |
| Release sets claim status to 'released' | Pass |
| Release rejects wrong agent (403) | Pass |
| Re-claim after release succeeds | Pass |

**`test/inbox.test.ts` — 7 tests:**

| Test | Status |
|---|---|
| Returns emails for a mailbox | Pass |
| Requires ?mailbox= query param | Pass |
| Requires Bearer token (401) | Pass |
| Filters by since= timestamp | Pass |
| Respects limit= param | Pass |
| Returns empty array for unknown mailbox | Pass |
| Email objects contain expected fields | Pass |

**`test/send.test.ts` — 5 tests:**

| Test | Status |
|---|---|
| Queues outbound email and returns id | Pass |
| Requires from and to fields | Pass |
| Requires Bearer token | Pass |
| Stores multiple recipients as JSON | Pass |
| Stores HTML body when provided | Pass |

**`test/webhook.test.ts` — 5 tests:**

| Test | Status |
|---|---|
| Stores email in DB via webhook | Pass |
| Rejects missing required fields | Pass |
| Stores email even without active claim | Pass |
| Validates webhook secret when configured | Pass |
| Webhook email becomes available via inbox route | Pass |

**`test/e2e.test.ts` — 6 tests (cross-server integration):**

| Test | Status |
|---|---|
| claimMailbox() works against real hosted server (init → verify → bind) | Pass |
| Duplicate handle rejected by real hosted server | Pass |
| Webhook → hosted inbox → syncMailbox → local DB (full pipeline) | Pass |
| Incremental sync uses since= and sync_cursor is persisted | Pass |
| sendMailHosted() queues email via real hosted send endpoint | Pass |
| releaseMailbox() releases on hosted and clears local binding | Pass |

### E2E integration architecture

The E2E tests use a novel bridging technique: the local server's `_setFetch()` is configured to route all hosted HTTP calls through the Hono hosted app's `.request()` method directly (in-process). Both databases (local SQLite and hosted SQLite) are initialized in-memory per test. This provides:

- **Zero network I/O**: No TCP sockets, no port conflicts
- **Full isolation**: Each test gets fresh DBs for both local and hosted
- **Real logic**: No mocks — the actual hosted claim verification, inbox queries, and send queuing are exercised
- **Production-equivalent**: The code paths are identical to what runs in production

---

## 4. What Is Now Stable / Frozen

1. **Hosted API contract**: The 5 endpoints match the local server's `hostedRequest()` call sites exactly. Changes require coordinated updates to both packages.
2. **Claim protocol**: init → challenge → sign → verify → bind. Challenge TTL is 5 minutes. The hosted server verifies Ed25519 signatures using `node:crypto`.
3. **Webhook format**: JSON with `from_address` and `to_address` as minimum required fields. Extensible via headers/metadata.
4. **Auth model**: Bearer token for inbox/send; webhook secret for inbound. Dev token env var for development.
5. **Package structure**: `packages/hosted/` follows the same conventions as `packages/server/` — Bun runtime, Hono framework, `createApp()` factory, `_createTestDb()` / `_resetDb()` test hooks.

---

## 5. What Remains — Your Part (Infrastructure & Deployment)

| Item | What you need to do | Notes |
|---|---|---|
| **DNS: A record for `api.agenova.chat`** | Point to your hosting provider (Fly.io, Railway, VPS) | Required for the hosted server |
| **DNS: MX record for `agenova.chat`** | Point to your inbound email provider (Mailgun, Cloudflare) | Required for receiving `@agenova.chat` email |
| **DNS: SPF + DKIM + DMARC** | Configure per your outbound provider (Resend, Mailgun, SES) | Required for email deliverability |
| **Deploy `packages/hosted/`** | `bun run src/index.ts` on your server; set `PORT`, `AGENOVA_HOSTED_DB_PATH`, `AGENOVA_DEV_TOKEN` | The code is ready to deploy as-is |
| **Configure email webhook** | Point your inbound provider's webhook at `https://api.agenova.chat/v1/webhook/inbound` | Set `AGENOVA_WEBHOOK_SECRET` for security |
| **Outbound email worker** | Implement a background job that reads `outbound_queue` and delivers via Resend/Mailgun/SES API | The queue table is ready; delivery logic is provider-specific |
| **Generate API tokens** | Insert SHA-256 hashed tokens into `api_tokens` table; configure local server with `AGENOVA_API_TOKEN` | Dev token works for testing |

### Recommended deployment steps

1. Deploy `packages/hosted/` with `AGENOVA_DEV_TOKEN=<your-secret>` and `PORT=3100`
2. Set `AGENOVA_HOSTED_URL=https://api.agenova.chat` and `AGENOVA_API_TOKEN=<your-secret>` on the local server
3. Run `claimMailboxAuto()` — it will automatically use the hosted path instead of local
4. Configure your email provider's webhook → `https://api.agenova.chat/v1/webhook/inbound`
5. Emails will flow: provider → webhook → hosted DB → sync poll → local DB → code extraction

---

## 6. What Remains Deferred

| Item | Classification | Notes |
|---|---|---|
| Outbound email delivery worker | Deferred — provider-specific | Queue table ready; delivery depends on Resend/Mailgun/SES choice |
| Handle validation rules (reserved words, profanity) | Deferred — non-blocking | Basic format validation exists (alphanumeric, 3-32 chars) |
| Challenge cleanup cron (expired rows) | Deferred — non-blocking | Expired challenges are marked but not deleted |
| Admin API (list claims, revoke tokens, view queue) | Deferred | Not needed for MVP |
| Attachment forwarding in webhook | Deferred | Webhook stores text; binary attachment support not implemented |
| WebSocket/SSE push as alternative to polling | Deferred | Per `agenova-prd-v0.1.md` §14.1 |

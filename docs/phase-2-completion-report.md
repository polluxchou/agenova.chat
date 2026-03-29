# Phase 2 Completion Report — Identity and Mailbox Binding

**Project:** Agenova Local Coordination Server
**Phase:** 2 — Identity and Mailbox Binding
**Status:** Complete
**Test Result (confirmed):** 136 tests, 0 failures across 10 files, 170ms (bun test v1.3.11)
**Phase 1 Baseline Preserved (confirmed):** All 35 Phase 1 tests remain green

---

## 1. Summary

Phase 2 implemented the product's main user flow: local agent creation, `@agenova.chat` mailbox claim and binding, device pairing, and identity recovery. A local claim simulation (`claimMailboxLocal()`) was introduced as the stable dev/test fallback, allowing the entire user journey to be validated offline without a running hosted service. All six acceptance criteria from `agenova-tech-startup-en.md` §6 are covered by passing tests.

---

## 2. Scope Covered

Phase 2 scope per `agenova-tech-startup-en.md` §4 Phase 2:

1. Create a local agent with Ed25519 identity
2. Request an `@agenova.chat` mailbox handle
3. Bind the mailbox to the agent
4. Persist hosted mailbox metadata in local DB

Additionally implemented per PRD requirements (`agenova-prd-v0.1.md` §5):

- Device pairing (LAN pairing session flow)
- Identity recovery (backup, export, restore, import on fresh node)
- Inbound email storage and search (Category 1 reuse from mails, owned by Agenova)
- Verification code extraction from email subject and body

---

## 3. What Is Completed (Confirmed)

### Database schema additions

| Item | Status | Evidence |
|---|---|---|
| `agents.hosted_mailbox TEXT UNIQUE` column | Confirmed | `src/db/schema.ts`; NULL until claim |
| `inbound_emails` table (10 columns + indexes) | Confirmed | `src/db/schema.ts`; field naming ported from mails conventions |
| `email_attachments` table | Confirmed | `src/db/schema.ts` |
| `idx_inbound_code` partial index (`WHERE code IS NOT NULL`) | Confirmed | `src/db/schema.ts` |

### Two-step agent flow (decoupled by design)

| Item | Status | Evidence |
|---|---|---|
| `createAgent()` creates identity only — `hosted_mailbox` starts NULL | Confirmed | `modules/identity/index.ts`; INSERT does not include `hosted_mailbox` |
| `claimMailboxLocal()` is an explicit, separate step | Confirmed | `modules/mailbox-claim/index.ts` |
| `claimMailboxAuto()` selects local vs hosted via `AGENOVA_HOSTED_URL` | Confirmed | `modules/mailbox-claim/index.ts` |

### Local claim simulation (`claimMailboxLocal`)

| Item | Status | Evidence |
|---|---|---|
| Uniqueness check (no two agents with the same handle) | Confirmed | Calls `getAgentByHostedMailbox()` before binding; throws on conflict |
| Ed25519 challenge/sign/verify cycle | Confirmed | Generates challenge, signs with provided keys, verifies against stored public key |
| Binding persisted to `agents.hosted_mailbox` | Confirmed | `bindMailbox()` issues `UPDATE agents SET hosted_mailbox = ?` |
| `AGENOVA_MAILBOX_DOMAIN` env var respected | Confirmed | Defaults to `agenova.chat` |
| Re-claim by same agent rejected | Confirmed | `agent.hosted_mailbox` guard at function entry |

### Inbound mail module (Category 1 — mails pattern reuse, Agenova-owned)

| Item | Status | Evidence |
|---|---|---|
| `saveEmail()` — stores inbound emails to local DB | Confirmed | `modules/inbound-mail/index.ts` |
| `getEmails()` — paginated inbox listing | Confirmed | LIMIT/OFFSET with direction filter |
| `searchEmails()` — LIKE/NOCASE/ESCAPE full-text search | Confirmed | Pattern ported from `mails/src/providers/storage/sqlite.ts` |
| `waitForCode()` — polling with configurable timeout | Confirmed | `modules/inbound-mail/index.ts` |
| `getLatestCode()` — non-blocking code lookup | Confirmed | `modules/inbound-mail/index.ts` |

### Device pairing

| Item | Status | Evidence |
|---|---|---|
| `startPairing()` — 6-digit numeric code, 5-minute TTL | Confirmed | `modules/device/index.ts` |
| `approvePairing()` — validates code, rejects expired/used sessions, creates device | Confirmed | `modules/device/index.ts` |
| `revokeDevice()`, `listDevices()`, `getDevice()` | Confirmed | `modules/device/index.ts` |
| Pairing session single-use enforcement | Confirmed | Status set to `'approved'` on first use; second use fails `status = 'pending'` filter |

### Recovery vault

| Item | Status | Evidence |
|---|---|---|
| `createRecoveryPack()` — 12-digit code, passphrase-encrypted bundle | Confirmed | `modules/recovery/index.ts` |
| `exportEncryptedBackup()` — returns encrypted blob | Confirmed | `modules/recovery/index.ts` |
| `restoreIdentity()` — decrypts and re-hydrates with recovery code | Confirmed | `modules/recovery/index.ts` |
| `importEncryptedBackup()` — fresh node restore (no existing auth required) | Confirmed | `modules/recovery/index.ts` |
| Re-creation of recovery pack invalidates old code | Confirmed | Overwrites `recovery_records` row; old code fails decryption |

### End-to-end validation

| Acceptance criterion (from `agenova-tech-startup-en.md` §6) | Status | Test coverage |
|---|---|---|
| Agenova starts locally | Confirmed | All tests via `createApp()` factory |
| Agent identity created | Confirmed | `flow-identity-mailbox.test.ts` step 1 |
| `@agenova.chat` mailbox requested and bound | Confirmed | `flow-identity-mailbox.test.ts` step 3 via local claim |
| Mail received and searched | Confirmed | `flow-identity-mailbox.test.ts` steps 4–5; HTTP inbox route test |
| Verification codes extracted automatically | Confirmed | `flow-identity-mailbox.test.ts` step 5 |
| Identity restored on another device | Confirmed | `flow-recovery.test.ts` — import from raw encrypted blob |
| Critical paths covered by automated tests | Confirmed | 136 tests, 0 failures |

### New test files added in Phase 2

| File | Tests | Coverage |
|---|---|---|
| `test/flow-identity-mailbox.test.ts` | 8 | Full E2E: create agent → claim mailbox → receive mail → extract code (module-level and HTTP routes) |
| `test/flow-device.test.ts` | 9 | Pairing lifecycle, expiry, code reuse rejection, cross-agent isolation, HTTP routes |
| `test/flow-recovery.test.ts` | 8 | Recovery round-trip, post-recovery signing, wrong code rejection, HTTP import route |

---

## 4. What Is Now Stable / Frozen

1. **Local claim path** (`claimMailboxLocal()`) is the confirmed stable dev/test baseline. It must not be modified or removed. The hosted claim path in Phase 3 extends it; it does not replace it.
2. **`claimMailboxAuto()` selection logic**: Uses `AGENOVA_HOSTED_URL` env var. No env var = local claim. This is the gate between development and production mode.
3. **`agents.hosted_mailbox` column name**: Frozen per `agenova-tech-startup-en.md`.
4. **Two-step flow contract**: `createAgent()` never sets `hosted_mailbox`. The column is only written by `bindMailbox()`. This contract must be preserved across all future phases.
5. **Test isolation**: `setupTest()` / `teardownTest()` with fixed master key and in-memory DB. No Phase 2 or future test may depend on hosted infrastructure or the filesystem.
6. **Primary user journey baseline**: create → claim → receive mail → extract code → device pair → recover identity is confirmed working end-to-end and serves as the reference path for all future work.

---

## 5. What Remains Deferred or Non-Blocking

| Item | Classification | Notes |
|---|---|---|
| Hosted `claimMailbox()` real protocol validation | Deferred — pending hosted team | Hosted API contract not yet finalized per `agenova-tech-startup-en.md` §7 |
| `mailbox_status`, `claimed_at`, `sync_cursor` fields on agents table | Deferred — non-blocking | Listed as follow-up in pre-coding confirmation; not required for Phase 2 |
| LAN mDNS discovery (`_agenova._tcp.local`) | Deferred | `modules/device` scaffold exists; no mDNS library integrated |
| Attachment text extraction pipeline | Deferred | `email_attachments` table and `text_extraction_status` field exist; extraction logic not implemented |
| Sync retry and timeout configuration | Deferred | Addressed in Phase 3 |

---

## 6. Impact on the Next Phase

Phase 3 (hosted integration) begins with a fully validated local flow. The `claimMailboxLocal()` path provides the offline regression baseline. Phase 3 adds the production hosted path by introducing a testable hosted HTTP client with injectable fetch, then wiring `claimMailbox()` and `syncMailbox()` to use it. The 136-test baseline must remain green throughout Phase 3 without modification.

# Phase 5 Completion Report — Sync Robustness & Schema Maturation

**Project:** Agenova Local Coordination Server
**Phase:** 5 — Sync Robustness & Schema Maturation
**Status:** Complete
**Test Result (confirmed):** 204 tests, 0 failures across 16 files (bun test v1.3.11)
**Baseline Preserved (confirmed):** All 159 Phase 1–3 tests remain green
**Phase 5 specific tests:** 6 (in `test/sync-robustness.test.ts`)

---

## 1. Summary

Phase 5 hardened the sync pipeline and matured the database schema for production readiness. Three new columns were added to the `agents` table (`mailbox_status`, `claimed_at`, `sync_cursor`), email deduplication was switched from `INSERT OR REPLACE` to `INSERT OR IGNORE`, and the sync loop was made configurable via environment variable. The sync cursor is now persisted per-agent instead of derived from a table scan, making incremental sync O(1) instead of O(n).

---

## 2. Scope Covered

Phase 5 scope as defined in the Phase 5 proposal:

- Add `sync_cursor`, `mailbox_status`, `claimed_at` columns to agents table
- Add deduplication guard in `saveEmail()` — `INSERT OR IGNORE` to prevent duplicate rows
- Move sync cursor from `MAX(received_at)` table scan to agent row lookup
- Add `AGENOVA_SYNC_INTERVAL_MS` env var support for configurable poll interval
- Add unique partial index on `inbound_emails.message_id`

---

## 3. What Is Completed (Confirmed)

### Schema changes (`src/db/schema.ts`)

| Addition | Type | Purpose |
|---|---|---|
| `agents.mailbox_status` | `TEXT NOT NULL DEFAULT 'unclaimed'` | Tracks claim lifecycle: unclaimed → claimed → suspended |
| `agents.claimed_at` | `TEXT` | ISO timestamp of when the mailbox was claimed |
| `agents.sync_cursor` | `TEXT` | Last successfully synced `received_at` value per agent |
| `idx_inbound_message_id` | Partial unique index | `WHERE message_id IS NOT NULL` — prevents RFC Message-ID duplicates |

### Module changes

**`src/modules/identity/index.ts`**:
- `createAgent()` INSERT now includes `mailbox_status = 'unclaimed'`
- Agent object literal includes `mailbox_status: 'unclaimed' as const`

**`src/modules/mailbox-claim/index.ts`**:
- `bindMailbox()` now issues: `UPDATE agents SET hosted_mailbox = ?, mailbox_status = 'claimed', claimed_at = ?, updated_at = ?`
- Claim timestamp recorded at the exact moment of binding

**`src/modules/inbound-mail/index.ts`**:
- `INSERT OR REPLACE INTO inbound_emails` → `INSERT OR IGNORE INTO inbound_emails`
- `INSERT OR REPLACE INTO email_attachments` → `INSERT OR IGNORE INTO email_attachments`
- Duplicate emails from overlapping sync windows are silently skipped instead of overwritten

**`src/modules/hosted-sync/index.ts`**:
- Removed `getLastSyncedAt()` function (was `SELECT MAX(received_at) FROM inbound_emails`)
- Added `getSyncCursor(mailbox)` — reads `agents.sync_cursor`, falls back to `MAX(received_at)` for backward compatibility
- Added `updateSyncCursor(mailbox, cursor)` — writes cursor to agent row after successful sync
- `startSyncLoop()` now reads `AGENOVA_SYNC_INTERVAL_MS` from environment: `Number(process.env.AGENOVA_SYNC_INTERVAL_MS) || 30000`

### Type changes (`src/types.ts`)

Added to `Agent` interface:
```typescript
mailbox_status?: 'unclaimed' | 'claimed' | 'suspended'
claimed_at?: string
sync_cursor?: string
```

### Test coverage (`test/sync-robustness.test.ts` — 6 tests)

| Test | Status |
|---|---|
| Deduplication: same email id synced twice → only 1 row stored | Pass |
| sync_cursor written to agents table after successful sync | Pass |
| sync_cursor used as since= parameter on second call | Pass |
| sync_cursor not updated when sync returns 0 emails | Pass |
| startSyncLoop accepts AGENOVA_SYNC_INTERVAL_MS env var | Pass |
| saveEmail INSERT OR IGNORE prevents duplicate rows (direct call) | Pass |

---

## 4. What Is Now Stable / Frozen

1. **`agents` table schema**: The three new columns (`mailbox_status`, `claimed_at`, `sync_cursor`) are frozen. Their names and semantics must not change.
2. **Deduplication contract**: `INSERT OR IGNORE` is the final behavior. Email syncs are idempotent — running the same sync window twice produces no duplicates.
3. **Sync cursor lifecycle**: Written after every successful sync with >0 emails. Read before every sync poll. Falls back to `MAX(received_at)` if cursor is NULL (first run or schema migration).
4. **Mailbox status transitions**: `unclaimed` → `claimed` (via `bindMailbox`). The `suspended` state exists in the schema check constraint but is not yet used — reserved for future moderation.
5. **Environment variable**: `AGENOVA_SYNC_INTERVAL_MS` is the only way to configure poll frequency. No config file or API endpoint.

---

## 5. What Remains Deferred or Non-Blocking

| Item | Classification | Notes |
|---|---|---|
| `mailbox_status = 'suspended'` transition logic | Deferred | Check constraint exists; no code path sets it yet |
| `releaseMailbox()` → `mailbox_status = 'unclaimed'` | Deferred — follow-up | Release currently only NULLs `hosted_mailbox`; should also reset status |
| Migration tooling for existing DBs | Deferred | Schema is applied from scratch; live DBs need manual `ALTER TABLE` |
| Cursor-based deduplication by `message_id` | Deferred — non-blocking | Unique index exists; `INSERT OR IGNORE` on `id` is the primary guard |

---

## 6. Impact on the Next Phase

Phase 5's sync improvements directly support Phase 6 (hosted integration). The sync cursor enables efficient incremental polling against the real hosted API — only new emails since the last cursor are fetched. The deduplication guard ensures network retries or overlapping windows don't create duplicate local rows. The `mailbox_status` and `claimed_at` fields provide the metadata foundation for the hosted server's claim management.

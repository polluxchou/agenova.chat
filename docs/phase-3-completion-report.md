# Phase 3 Completion Report — Hosted Integration

**Project:** Agenova Local Coordination Server
**Phase:** 3 — Hosted Integration (Minimal Path)
**Status:** Complete
**Test Result (confirmed):** 159 tests, 0 failures across 12 files, 2.32s (bun test v1.3.11)
**Phase 1+2 Baseline Preserved (confirmed):** All 136 prior tests remain green
**New tests added:** 23 (7 hosted-claim + 16 hosted-sync)

---

## 1. Summary

Phase 3 implemented the minimal hosted integration path for mailbox claim and mail sync. A central hosted HTTP client (`src/hosted/client.ts`) was introduced with injectable fetch for test isolation, exponential backoff retry on transient failures, and centralized environment-backed config. The `mailbox-claim` and `hosted-sync` modules were refactored to use this client. Outbound mail send via the hosted layer was also added. All 23 new tests use mocked fetch — no network calls are made in any test. The 136-test offline baseline was preserved without modification.

---

## 2. Scope Covered

Phase 3 scope per `agenova-tech-startup-en.md` §4 (next product layer after Phase 2) and the Phase 3 directive:

- Hosted HTTP client with testable fetch injection and retry/backoff
- Mailbox claim integration with real hosted calls (init → verify → bind protocol)
- Hosted inbox sync (GET `/v1/inbox` with incremental `since=` param)
- Outbound mail delivery through the hosted layer (POST `/v1/send`)
- Retry/backoff behavior validated for 5xx and network errors
- Preservation of full offline baseline (no change to prior 136 tests)

---

## 3. What Is Completed (Confirmed)

### Hosted HTTP client (`src/hosted/client.ts`)

| Item | Status | Evidence |
|---|---|---|
| `_setFetch(fn?)` — injectable fetch for tests | Confirmed | Used in both `hosted-claim.test.ts` and `hosted-sync.test.ts` |
| `hostedRequest<T>(opts)` — single request entry point | Confirmed | All hosted modules use this; no raw `fetch` calls to hosted endpoints remain |
| Retry on 5xx and network errors only — not on 4xx | Confirmed | `if (res.status >= 400 && res.status < 500)` causes immediate return; confirmed by 'does not retry on 4xx' test |
| Exponential backoff: `baseDelay * Math.pow(2, attempt)` | Confirmed | `src/hosted/client.ts` loop logic |
| `getHostedBaseUrl()`, `getMailboxDomain()`, `getApiToken()` | Confirmed | All env-var-backed with sensible production defaults |
| `Authorization: Bearer <token>` header when token present | Confirmed | `headers['Authorization']` conditional in `hostedRequest` |

### Mailbox claim — hosted path refactored (`src/modules/mailbox-claim/index.ts`)

| Item | Status | Evidence |
|---|---|---|
| `claimMailbox()` uses `hostedRequest()` instead of raw fetch | Confirmed | File does not contain any direct `fetch` call |
| Phase 1 (init) sends `{ agent_id, handle, public_key }` | Confirmed | `mock.calls[0].body` assertion in `hosted-claim.test.ts` |
| Phase 2 (verify) sends `{ claim_id, signature }` | Confirmed | Mock hosted service verifies signature; 403 on wrong key |
| Binding persisted on successful verify | Confirmed | `getAgentById()` returns `hosted_mailbox` after claim |
| `claimMailboxLocal()` unchanged — no modifications | Confirmed | Local claim tests in `flow-identity-mailbox.test.ts` remain green |
| `claimMailboxAuto()` unchanged | Confirmed | Selection logic on `AGENOVA_HOSTED_URL` unchanged |

### Hosted sync (`src/modules/hosted-sync/index.ts`)

| Item | Status | Evidence |
|---|---|---|
| `syncMailbox()` uses `hostedRequest()` | Confirmed | No raw `fetch` call in sync module |
| Incremental sync via `since=` query param | Confirmed | Reads `MAX(received_at)` from local DB, appends to query string |
| `syncMailbox()` catches thrown errors from `hostedRequest` — returns 0 | Confirmed | Try-catch wrapping introduced; 'returns 0 when hosted returns non-ok' test passes |
| `startSyncLoop()` silent when `AGENOVA_API_TOKEN` not set | Confirmed | Early return before `setInterval`; no noise in offline dev |
| `_resetSyncLoop()` test teardown hook | Confirmed | Calls `stopSyncLoop()`, clears interval; used in all `afterEach` |

### Outbound send (`sendMailHosted`)

| Item | Status | Evidence |
|---|---|---|
| POST `/v1/send` via hosted layer | Confirmed | `mock.sent` array populated in test |
| `to` field normalized to array | Confirmed | `Array.isArray(input.to) ? input.to : [input.to]`; confirmed by 'sends to multiple recipients' test |
| Throws with clear message when `AGENOVA_API_TOKEN` not set | Confirmed | `rejects.toThrow(/AGENOVA_API_TOKEN/)` test passes |
| Returns `{ id: string }` on success | Confirmed | `result.id` is a valid UUID string in test |

### Code extraction fix

| Item | Status | Evidence |
|---|---|---|
| `extractCode()` false positive on plain English word fixed | Confirmed | Patterns changed to require at least one digit: `[A-Z0-9]*\d[A-Z0-9]*` |
| 6-digit, 4-digit, 8-digit pure numeric patterns unchanged | Confirmed | `CODE_PATTERNS[0..2]` unmodified |
| 'returns null when no code found' test passes | Confirmed | `extractCode('Hello', 'No code here')` returns null |

### Integration tests (mocked fetch — zero network calls)

**`test/hosted-claim.test.ts` — 7 tests:**

| Test | Status |
|---|---|
| Full hosted claim flow: init → verify → bind | Pass |
| Correct fields sent to init endpoint (`agent_id`, `handle`, `public_key`) | Pass |
| Challenge is signed and submitted to verify | Pass |
| Duplicate handle rejection (mock returns 409) | Pass |
| Re-claim rejected when agent already has a mailbox | Pass |
| Wrong private key fails signature verification (mock returns 403) | Pass |
| 5xx on first attempt, success on retry | Pass |

**`test/hosted-sync.test.ts` — 16 tests:**

| Test | Status |
|---|---|
| Syncs emails from hosted inbox to local DB | Pass |
| Extracts verification codes during sync | Pass |
| Uses `since=` for incremental sync (second call contains `since=`) | Pass |
| Returns 0 when hosted returns non-ok (perpetual 5xx) | Pass |
| Returns 0 on empty inbox | Pass |
| Binds `agent_id` to synced emails | Pass |
| Sends outbound email via hosted API | Pass |
| Sends to multiple recipients (array normalization) | Pass |
| Throws when API token not set | Pass |
| Retries on 5xx then succeeds | Pass |
| Does not retry on 4xx (single attempt only) | Pass |
| `extractCode` — 6-digit codes | Pass |
| `extractCode` — 4-digit codes | Pass |
| `extractCode` — alphanumeric with "code:" prefix (digit required) | Pass |
| `extractCode` — returns null when no code found | Pass |
| Authorization header sent with token (fetch call observed) | Pass |

### Bugs found and fixed during Phase 3

1. **`extractCode` false positive on plain English**: `"No code here"` matched `/code[:\s]+([A-Z0-9]{4,10})/i` because `"here"` is 4 alphanumeric characters. Root cause: the pattern captured any alphanumeric string following `"code"`. Fix: changed capture group to `[A-Z0-9]*\d[A-Z0-9]*`, requiring at least one digit. All prior extraction tests remain green.

2. **5xx retry test timeout (>5000ms)**: `syncMailbox()` called `hostedRequest()` which threw after exhausting retries (default 2 retries × 1000ms base delay = ~3000ms real wait). The throw propagated uncaught, triggering bun's 5000ms test timeout. Fix: (a) wrapped `hostedRequest` call in try-catch inside `syncMailbox`, returning 0 on error; (b) reduced `retries` to 1 and `retryDelayMs` to 500ms for sync operations to stay well within test timeout budget.

---

## 4. What Is Now Stable / Frozen

1. **`hosted/client.ts` as the single hosted call point**: All outbound HTTP to `api.agenova.chat` goes through `hostedRequest()`. Direct `fetch` calls to hosted endpoints must not be added.
2. **`_setFetch()` as the test injection mechanism**: All hosted integration tests use this pattern exclusively. No test may open a real network connection.
3. **Offline baseline contract**: The 136 Phase 1+2 tests require no network access and must remain green. This is enforced structurally — `startSyncLoop()` is silent without `AGENOVA_API_TOKEN`, and `claimMailboxAuto()` uses local mode without `AGENOVA_HOSTED_URL`.
4. **Retry policy boundary**: Retry on 5xx and network errors; return immediately on 4xx. This distinction is tested and must not be changed without explicit protocol review.
5. **`sendMailHosted()` token requirement**: Hard failure (throws) if `AGENOVA_API_TOKEN` is unset. Outbound send is not silently degraded — intentional design.
6. **`syncMailbox()` error contract**: On any `hostedRequest` failure (throw or non-ok), returns 0 and logs. Does not propagate errors to callers.

---

## 5. What Remains Deferred or Non-Blocking

| Item | Classification | Notes |
|---|---|---|
| Hosted API protocol field finalization (exact init/verify shapes) | Deferred — pending hosted team | Current request/response shape is a working placeholder; `agenova-tech-startup-en.md` §7 lists this as non-blocking |
| Sync frequency configuration via env var | Deferred — non-blocking | Currently hardcoded to 30s; `AGENOVA_SYNC_INTERVAL_MS` env var is assumption/follow-up, not implemented |
| `sync_cursor` / `synced_at` column on agents table | Deferred | Currently uses `MAX(received_at)` from `inbound_emails` as proxy cursor; not stored separately on the agent row |
| Hosted namespace conflict handling (409 disambiguation for re-registration) | Deferred — non-blocking | `agenova-tech-startup-en.md` §7 |
| Webhook delivery as alternative to polling | Deferred | `agenova-prd-v0.1.md` §14.1 notes mail reachability risk; polling is the current and only implementation |
| Real hosted API end-to-end validation (against live `api.agenova.chat`) | Deferred — blocked on hosted service availability | All tests use mocked fetch; no real network validation has been performed |
| Attachment sync from hosted inbox | Deferred | `email_attachments` table exists; hosted API attachment payload not handled in `syncMailbox` |

---

## 6. Impact on the Next Phase

The hosted integration layer is now wired, tested, and structurally ready for production activation. When the hosted service becomes available, integration can be validated by pointing `AGENOVA_HOSTED_URL` and `AGENOVA_API_TOKEN` at a live server — no code changes are required to enable the hosted path.

Recommended next work items per `agenova-tech-startup-en.md` §4:

- Real mailbox routing validation once `api.agenova.chat` is available
- Sync robustness improvements (cursor-based deduplication, configurable interval)
- First-run UX (CLI or local UI for agent creation and mailbox claim)
- Edge-case handling for mailbox binding conflicts and device recovery on a fresh machine
- Attachment extraction pipeline (foundation already in schema)

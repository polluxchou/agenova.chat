# Phase 1 Completion Report — Agenova Server Foundation

**Project:** Agenova Local Coordination Server
**Phase:** 1 — Foundation
**Status:** Complete
**Test Result (confirmed):** 136 tests, 0 failures across 10 files, 235ms (bun test v1.3.11)

---

## 1. Summary

Phase 1 established the server baseline, module scaffold, and full test infrastructure for the Agenova Local Coordination Server (`packages/server/`). The primary deliverable was a testable, modular Hono application with unit coverage across the identity, authentication, and policy critical paths. All Phase 1 acceptance criteria from `agenova-tech-startup-en.md` §4 Phase 1 are confirmed met.

---

## 2. Scope Covered

Phase 1 scope was defined by `agenova-tech-startup-en.md` §4 Phase 1:

- Add test infrastructure for the server
- Add reset hooks for cached DB and master key state
- Split the Hono app into a testable app factory (`createApp()`)
- Cover the critical identity, auth, and policy paths with unit tests

Additionally, the full module and route scaffold was implemented as the prerequisite surface area for test coverage.

---

## 3. What Is Completed (Confirmed)

### Server scaffold

| Item | Status | Evidence |
|---|---|---|
| `packages/server/package.json` with Bun runtime and `bun test` script | Confirmed | File exists; `bun test test/` passes |
| `tsconfig.json` targeting ESNext with bun-types | Confirmed | File exists |
| Hono HTTP server on port 7700 | Confirmed | `src/index.ts` exports `{ port: 7700, fetch: app.fetch }` |
| `createApp(opts)` factory separated from `index.ts` | Confirmed | `src/app.ts` exists; `src/index.ts` calls it without business logic |

### Database layer

| Item | Status | Evidence |
|---|---|---|
| 8-table SQLite schema (agents, devices, pairing_sessions, permission_grants, mail_envelopes, memory_items, model_keys, recovery_records) | Confirmed | `src/db/schema.ts` |
| WAL mode and foreign key enforcement | Confirmed | `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` in schema |
| `_createTestDb()` in-memory isolation hook | Confirmed | `src/db/client.ts` |
| `_resetDb()` teardown hook | Confirmed | `src/db/client.ts` |

### Cryptography (`src/crypto.ts`)

| Item | Status | Evidence |
|---|---|---|
| Ed25519 keypair generation | Confirmed | `generateEd25519Keypair()` using Node.js `crypto.generateKeyPairSync('ed25519')` |
| Agent ID derivation via UUIDv5 with NIT_NAMESPACE `801ba518-f326-47e5-97c9-d1efd1865a19` | Confirmed | `deriveAgentId()` mirrors `nit/src/identity.ts` exactly |
| `signMessage()` and `verifySignature()` using Ed25519 | Confirmed | Both accept raw base64 and `ed25519:<base64>` formats |
| AES-256-GCM encryption with HKDF key derivation | Confirmed | `encrypt()` / `decrypt()` with purpose + salt scoping |
| Passphrase-derived encryption for recovery | Confirmed | `encryptWithPassphrase()` / `decryptWithPassphrase()` |
| `_resetMasterKey(inject?)` test hook | Confirmed | `src/crypto.ts` |

### Modules (scaffolded)

All 7 modules scaffolded and confirmed present: `identity`, `device`, `policy`, `mailbox`, `memory`, `model-keys`, `recovery`.

### Middleware

| Item | Status | Evidence |
|---|---|---|
| `authMiddleware` — Ed25519 request signature verification | Confirmed | `src/middleware/auth.ts`; covered by auth tests |
| `requireScope()` policy guard factory | Confirmed | `src/middleware/policy-guard.ts`; covered by policy tests |
| Signing payload format: `METHOD\nPATHNAME\nX-Timestamp\nSHA-256(body)` | Confirmed | Auth middleware and `buildAuthHeaders` helper agree |
| 5-minute replay protection window | Confirmed | `Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS` |

### Routes

7 route modules confirmed present and mounted under `/v1`: `identity`, `device`, `policy`, `mailbox`, `inbound-mail`, `memory`, `model-keys`, `recovery`.

### Test infrastructure

| Item | Status | Evidence |
|---|---|---|
| `test/helpers.ts` — `setupTest`, `teardownTest`, `createTestAgent`, `buildAuthHeaders`, `req()` | Confirmed | File exists; used by all test files |
| `test/identity.test.ts` — 12 tests | Confirmed | All pass |
| `test/auth.test.ts` — 11 tests | Confirmed | All pass |
| `test/policy.test.ts` — 12 tests | Confirmed | All pass |

### Bugs found and fixed during Phase 1

- **`buildAuthHeaders` path/query mismatch**: The helper initially signed the full URL path including query parameters, but the auth middleware extracted only `pathname`. Fixed by stripping query params in `buildAuthHeaders`: `const pathname = path.split('?')[0]`.
- **`bun` not in non-interactive shell PATH**: Required `export PATH="$HOME/.bun/bin:$PATH"` prefix for Bash commands. Documented as a local environment issue, not a code defect.

---

## 4. What Is Now Stable / Frozen

The following decisions are frozen per `agenova-tech-startup-en.md` and confirmed implemented:

1. **Runtime**: Bun is the sole runtime. No Node/npm compatibility layer is planned.
2. **Test commands**: `bun test test/` (unit/integration), `bun test --watch test/` (watch mode).
3. **App factory pattern**: `createApp(opts)` is the single testable entry point. `index.ts` contains only startup orchestration.
4. **Test isolation contract**: All tests call `setupTest()` in `beforeEach` and `teardownTest()` in `afterEach`. No test touches the filesystem DB or the real master key.
5. **Signing payload format**: `METHOD\nPATHNAME\nTimestamp\nBodyHash`. This is the wire contract between clients and the server.
6. **NIT_NAMESPACE UUID**: `801ba518-f326-47e5-97c9-d1efd1865a19` — frozen to maintain nit compatibility.
7. **DB table names**: All 8 original tables are frozen for Phase 1 and Phase 2.

---

## 5. What Remains Deferred or Non-Blocking

| Item | Classification | Notes |
|---|---|---|
| npm compatibility / Node.js fallback | Deferred — non-blocking | `agenova-tech-startup-en.md` §7 lists "final runtime choice details" as non-blocking follow-up |
| Integration tests for `memory`, `model-keys`, `recovery` module routes | Deferred to Phase 2/3 | Phase 1 scoped to identity, auth, policy per tech doc |
| Error code standardization (beyond 401/403/404/409) | Deferred — non-blocking | Listed in `agenova-tech-startup-en.md` §7 |
| LAN mDNS discovery implementation | Deferred | Device module scaffold exists; mDNS library not yet integrated |

---

## 6. Impact on the Next Phase

Phase 2 (Identity and Mailbox Binding) begins with a stable, fully tested baseline. The `createApp()` factory, in-memory test DB, and injectable reset hooks are available to all Phase 2 test files. The identity module, auth middleware, and policy engine are confirmed correct via 35 unit tests, providing a reliable foundation for the mailbox claim flow and E2E integration tests.

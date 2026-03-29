# Agenova v1 — Technical Plan

## 1. Project Structure

```
agenova/
├── packages/
│   ├── nit/          (existing — reused as-is for crypto primitives)
│   ├── mails/        (existing — reused for email schema and SQLite patterns)
│   └── server/       (new — Local Coordination Server)
│       ├── src/
│       │   ├── index.ts              # Server entry point
│       │   ├── db/
│       │   │   ├── schema.ts         # Table definitions
│       │   │   └── client.ts         # SQLite connection (better-sqlite3)
│       │   ├── modules/
│       │   │   ├── identity/         # Identity Registry
│       │   │   ├── device/           # LAN pairing & device management
│       │   │   ├── policy/           # Permission / scope engine
│       │   │   ├── mailbox/          # Mail envelope build/sign/route
│       │   │   ├── memory/           # Memory Ledger
│       │   │   ├── model-keys/       # Model Key Broker
│       │   │   └── recovery/         # Recovery Vault
│       │   ├── routes/
│       │   │   ├── identity.ts
│       │   │   ├── device.ts
│       │   │   ├── policy.ts
│       │   │   ├── mailbox.ts
│       │   │   ├── memory.ts
│       │   │   ├── model-keys.ts
│       │   │   └── recovery.ts
│       │   └── middleware/
│       │       ├── auth.ts           # Signature verification middleware
│       │       └── policy-guard.ts   # Scope check middleware
│       ├── package.json
│       └── tsconfig.json
└── docs/
```

## 2. Technology Choices

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js (or Bun) | Consistent with `nit` and `mails` |
| HTTP server | Hono | Lightweight, edge-compatible, simple middleware |
| Local DB | better-sqlite3 | Synchronous, zero-dep, matches `mails` SQLite provider pattern |
| Crypto | Re-use `nit` primitives | Ed25519 already implemented and tested |
| LAN discovery | UDP mDNS (`bonjour`/`@homebridge/ciao`) | Standard local-network service discovery |
| Encryption | Node.js `crypto` (AES-256-GCM) | Standard library, no extra deps needed |

## 3. Database Schema

All tables live in a single local file: `~/.agenova/agenova.db`

```sql
CREATE TABLE agents (
  agent_id          TEXT PRIMARY KEY,   -- UUIDv5 derived from public key (nit)
  email_address     TEXT UNIQUE NOT NULL,
  display_name      TEXT NOT NULL,
  public_key        TEXT NOT NULL,      -- base64 Ed25519 public key
  status            TEXT NOT NULL DEFAULT 'active',  -- active | suspended | revoked
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE devices (
  device_id           TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(agent_id),
  device_name         TEXT NOT NULL,
  device_fingerprint  TEXT UNIQUE NOT NULL,  -- SHA-256 of device public key
  device_public_key   TEXT,                   -- optional per-device Ed25519 key
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | active | revoked
  last_seen_at        TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE pairing_sessions (
  session_id    TEXT PRIMARY KEY,
  pairing_code  TEXT UNIQUE NOT NULL,  -- 6-digit numeric code
  agent_id      TEXT REFERENCES agents(agent_id),
  device_name   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | expired
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE permission_grants (
  grant_id       TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL REFERENCES agents(agent_id),
  scope          TEXT NOT NULL,         -- e.g. mail.read, memory.write
  resource_type  TEXT,
  resource_id    TEXT,
  granted_by     TEXT NOT NULL,         -- agent_id of grantor
  expires_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE mail_envelopes (
  message_id        TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL,
  from_agent        TEXT NOT NULL REFERENCES agents(agent_id),
  to_agent          TEXT NOT NULL REFERENCES agents(agent_id),
  message_type      TEXT NOT NULL,      -- task | reply | note | approval | system
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  headers           TEXT NOT NULL DEFAULT '{}',   -- JSON
  signature         TEXT NOT NULL,
  encryption_meta   TEXT,               -- JSON or NULL
  scope             TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE memory_items (
  memory_id             TEXT PRIMARY KEY,
  owner_agent_id        TEXT NOT NULL REFERENCES agents(agent_id),
  memory_type           TEXT NOT NULL,  -- conversation_summary | task_state | tool_result | fact | note
  title                 TEXT NOT NULL,
  content_ciphertext    TEXT NOT NULL,  -- AES-256-GCM encrypted, base64
  content_hash          TEXT NOT NULL,  -- SHA-256 of plaintext, for integrity
  visibility            TEXT NOT NULL DEFAULT 'private',  -- private | shared | public
  tags                  TEXT NOT NULL DEFAULT '[]',       -- JSON array
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE model_keys (
  key_id            TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(agent_id),
  provider          TEXT NOT NULL,   -- openai | anthropic | google | other
  alias             TEXT NOT NULL,
  encrypted_secret  TEXT NOT NULL,   -- AES-256-GCM encrypted, base64
  status            TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  created_at        TEXT NOT NULL,
  last_used_at      TEXT,
  UNIQUE(agent_id, alias)
);

CREATE TABLE recovery_records (
  record_id      TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL UNIQUE REFERENCES agents(agent_id),
  encrypted_blob TEXT NOT NULL,  -- AES-256-GCM, passphrase-derived key
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_devices_agent_id         ON devices(agent_id);
CREATE INDEX idx_grants_agent_scope       ON permission_grants(agent_id, scope);
CREATE INDEX idx_mail_from_agent          ON mail_envelopes(from_agent, created_at DESC);
CREATE INDEX idx_mail_to_agent            ON mail_envelopes(to_agent, created_at DESC);
CREATE INDEX idx_mail_thread              ON mail_envelopes(thread_id);
CREATE INDEX idx_memory_owner             ON memory_items(owner_agent_id, created_at DESC);
CREATE INDEX idx_model_keys_agent         ON model_keys(agent_id);
```

## 4. Server Endpoints

Base path: `http://localhost:7700` (configurable)

### Identity

| Method | Path | Description |
|---|---|---|
| POST | `/v1/agents` | Create agent — generates Ed25519 keypair, derives agent_id, binds email |
| GET | `/v1/agents/:agentId` | Get agent by ID |
| GET | `/v1/agents?email=` | Get agent by email address |
| DELETE | `/v1/agents/:agentId/devices/:deviceId` | Revoke a device |

### Recovery Vault

| Method | Path | Description |
|---|---|---|
| POST | `/v1/agents/:agentId/recovery` | Create encrypted recovery pack |
| POST | `/v1/agents/:agentId/recovery/verify` | Verify recovery code |
| POST | `/v1/agents/:agentId/recovery/restore` | Restore identity from recovery code |
| GET | `/v1/agents/:agentId/recovery/export` | Export encrypted backup blob |
| POST | `/v1/recovery/import` | Import backup blob + passphrase → restore identity |

### Device Pairing

| Method | Path | Description |
|---|---|---|
| POST | `/v1/pairing/start` | Initiate pairing — returns session_id + pairing_code |
| POST | `/v1/pairing/approve` | Host approves pairing code, binds device to agent |
| DELETE | `/v1/devices/:deviceId` | Unpair/revoke device |
| GET | `/v1/agents/:agentId/devices` | List devices for agent |

### Policy Engine

| Method | Path | Description |
|---|---|---|
| POST | `/v1/agents/:agentId/grants` | Grant a scope |
| DELETE | `/v1/agents/:agentId/grants/:grantId` | Revoke a scope |
| GET | `/v1/agents/:agentId/grants` | List all grants |
| POST | `/v1/policy/check` | Check `{ agentId, action, resourceType, resourceId }` → `{ allowed: boolean }` |

### Mailbox

| Method | Path | Description |
|---|---|---|
| POST | `/v1/mail/send` | Build, sign, policy-check, store and route envelope |
| GET | `/v1/agents/:agentId/mail/inbox` | List received messages (paginated) |
| GET | `/v1/agents/:agentId/mail/outbox` | List sent messages |
| GET | `/v1/mail/:messageId` | Get single envelope |
| GET | `/v1/mail/threads/:threadId` | Get all messages in a thread |

### Memory Ledger

| Method | Path | Description |
|---|---|---|
| POST | `/v1/agents/:agentId/memory` | Append memory item |
| GET | `/v1/agents/:agentId/memory` | Query memory (filter by type/tags/search) |
| PATCH | `/v1/memory/:memoryId` | Update memory item |
| DELETE | `/v1/memory/:memoryId` | Delete memory item |
| POST | `/v1/memory/:memoryId/share` | Share item with another agent (policy update) |

### Model Key Broker

| Method | Path | Description |
|---|---|---|
| POST | `/v1/agents/:agentId/model-keys` | Store encrypted model key |
| GET | `/v1/agents/:agentId/model-keys` | List model keys (aliases only, no secrets) |
| DELETE | `/v1/agents/:agentId/model-keys/:alias` | Revoke key |
| POST | `/v1/agents/:agentId/model-keys/:alias/invoke` | Proxy model call — checks policy, proxies, logs usage |

### Discovery (internal / LAN)

| Method | Path | Description |
|---|---|---|
| GET | `/v1/discovery/info` | Returns `{ nodeId, version, hostname }` — used during pairing |

## 5. Authentication Middleware

Every request (except `/v1/discovery/info` and `/v1/pairing/start`) must include:

```
X-Agent-Id: <agent_id>
X-Signature: <base64 Ed25519 signature>
X-Timestamp: <ISO timestamp>
```

The signed payload is:
```
<METHOD>\n<PATH>\n<X-Timestamp>\n<SHA-256 of request body or "">
```

The middleware:
1. Looks up the agent's public key from the identity registry
2. Verifies the signature using `nit`'s `signMessage` / verify logic
3. Rejects requests where timestamp is >5 minutes old (replay protection)

Re-use: `nit/src/identity.ts` — `signMessage()`, `formatPublicKeyField()`, `parsePublicKeyField()`

## 6. Mail Envelope Format

```ts
// Build
const envelope: MailEnvelope = {
  message_id: crypto.randomUUID(),
  thread_id: options.threadId ?? crypto.randomUUID(),
  from_agent: agentId,
  to_agent: options.to,
  message_type: options.type,
  subject: options.subject,
  body: options.body,
  headers: { 'content-type': 'text/plain', ...options.headers },
  signature: '',     // filled after signing
  scope: options.scope,
  created_at: new Date().toISOString(),
}

// Sign
const payload = JSON.stringify({
  message_id: envelope.message_id,
  from_agent: envelope.from_agent,
  to_agent: envelope.to_agent,
  subject: envelope.subject,
  body: envelope.body,
  created_at: envelope.created_at,
})
envelope.signature = await sign(payload, privateKey)  // nit Ed25519

// Optional encryption (AES-256-GCM with recipient's public key via ECDH-derived shared secret)
if (options.encrypt) {
  const { ciphertext, meta } = encryptForRecipient(envelope.body, recipientPublicKey)
  envelope.body = ciphertext
  envelope.encryption_meta = meta
}
```

Verification on receive:
1. Look up `from_agent` public key
2. Re-assemble payload from envelope fields
3. Verify Ed25519 signature

Re-use: `mails` `Email` schema as reference for field naming; `nit` for signing.

## 7. LAN Pairing Flow

```
Device (new)                  Host (server)
     |                             |
     |  UDP mDNS query             |
     |  _agenova._tcp.local        |
     |---------------------------->|
     |                             |
     |  mDNS response              |
     |  host:7700                  |
     |<----------------------------|
     |                             |
     |  POST /v1/pairing/start     |
     |  { deviceName, devicePubKey }
     |---------------------------->|
     |                             |
     |  { sessionId, pairingCode } |  (6-digit code shown on host)
     |<----------------------------|
     |                             |
     |  [User enters code on host] |
     |                             |
     |  POST /v1/pairing/approve   |
     |  { pairingCode, agentId }   |
     |  (called by host UI/CLI)    |
     |---------------------------->|
     |                             |
     |  { deviceId, agentId }      |
     |<----------------------------|
     |                             |
     |  Device is now bound        |
```

Session TTL: 5 minutes. Expired sessions are rejected. Pairing code is single-use.

## 8. Encryption for Memory and Model Keys

**At rest (Memory items, Model keys):**
- Algorithm: AES-256-GCM
- Key derivation: `HKDF(master_secret, salt=agent_id, info="memory")` for memory, `info="model-keys"` for keys
- Master secret: stored in `~/.agenova/master.key` (mode 0o600), generated on first run
- IV: random 12 bytes, prepended to ciphertext
- Output: `base64(iv + ciphertext + auth_tag)`

**For mail envelope encryption (optional):**
- Derive shared secret via ECDH: sender's Ed25519 seed → derive X25519 key → DH with recipient's X25519 key
- Then AES-256-GCM with derived shared key
- `encryption_meta`: `{ algorithm: "aes-256-gcm-x25519", recipient_key_id: <agent_id> }`

## 9. What to Import from Each Package

### From `nit`

Direct imports from `nit/src/identity.ts`:

```ts
import { deriveAgentId, loadRawKeyPair, signMessage, formatPublicKeyField, parsePublicKeyField } from '@newtype-ai/nit'
```

Use:
- `generateKeyPairSync('ed25519')` (Node crypto) — generate new agent keypair
- `deriveAgentId(publicKey)` — stable UUIDv5 agent ID
- `signMessage(payload, privateKey)` — sign envelope payload and auth headers
- `formatPublicKeyField` / `parsePublicKeyField` — serialize keys for DB storage

Do **not** import: CLI, wallet/tx, remote, refs, objects (not relevant to server).

### From `mails`

Import storage patterns and types as reference only — do **not** install `mails` as a runtime dep.

Copy/adapt:
- `mails/src/providers/storage/sqlite.ts` — schema migration pattern, WAL setup, JSON column helpers
- `mails/src/core/types.ts` — field names for `Email` used as basis for `MailEnvelope`

The `mails` package is a CLI/library tool for internet email; it should not be a server dependency. The server implements its own mailbox storage using the same SQLite patterns.

## 10. Module Responsibilities (Implementation Order)

### Phase 1 — Foundation

1. **`db/schema.ts`** — create all 8 tables with indexes, migration runner
2. **`modules/identity`** — `createAgent`, `getAgentByEmail`, `getAgentById` using nit crypto
3. **`middleware/auth.ts`** — Ed25519 request signature verification

### Phase 2 — Communication

4. **`modules/policy`** — grant/revoke/check scopes
5. **`modules/mailbox`** — build, sign, verify, store, route envelopes
6. **`middleware/policy-guard.ts`** — inline scope checks on routes

### Phase 3 — Persistence

7. **`modules/memory`** — encrypted memory items, CRUD + share
8. **`modules/model-keys`** — encrypted key storage + proxy invoke

### Phase 4 — Devices

9. **`modules/recovery`** — encrypted backup/restore
10. **`modules/device`** — LAN mDNS, pairing session, approve, revoke

## 11. Config File

`~/.agenova/config.json`

```json
{
  "port": 7700,
  "db_path": "~/.agenova/agenova.db",
  "master_key_path": "~/.agenova/master.key",
  "log_level": "info"
}
```

## 12. Success Milestones

| # | Milestone | Validates |
|---|---|---|
| 1 | `POST /v1/agents` creates agent + keypair stored in DB | Identity module |
| 2 | `POST /v1/mail/send` signs envelope and stores in DB | Mailbox + crypto |
| 3 | `GET /v1/agents/:id/mail/inbox` returns verified messages | Policy + mailbox |
| 4 | Second device on LAN pairs via mDNS + 6-digit code | LAN pairing |
| 5 | Memory item written + read back with correct decryption | Memory + encryption |
| 6 | Model key stored and `/invoke` proxies real API call | Key broker |
| 7 | `export` + `import` recovery restores identity on fresh DB | Recovery vault |

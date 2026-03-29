// ---------------------------------------------------------------------------
// Hosted API — SQLite schema
//
// This is the cloud-side DB that manages:
//   - Mailbox claim challenges and bindings
//   - Inbound email storage (received via webhook)
//   - Outbound email queue
//   - API token authentication
// ---------------------------------------------------------------------------

export const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Mailbox claims — handle → agent binding
CREATE TABLE IF NOT EXISTS mailbox_claims (
  handle          TEXT PRIMARY KEY,         -- e.g. "alice"
  hosted_mailbox  TEXT UNIQUE NOT NULL,     -- e.g. "alice@agenova.chat"
  agent_id        TEXT NOT NULL,
  public_key      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','released')),
  claimed_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Pending claim challenges (short-lived, 5 min TTL)
CREATE TABLE IF NOT EXISTS claim_challenges (
  claim_id        TEXT PRIMARY KEY,
  handle          TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  public_key      TEXT NOT NULL,
  challenge       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','verified','expired')),
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- Inbound emails received via webhook from email providers
CREATE TABLE IF NOT EXISTS emails (
  id              TEXT PRIMARY KEY,
  mailbox         TEXT NOT NULL,             -- e.g. "alice@agenova.chat"
  from_address    TEXT NOT NULL,
  from_name       TEXT NOT NULL DEFAULT '',
  to_address      TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  body_text       TEXT NOT NULL DEFAULT '',
  body_html       TEXT NOT NULL DEFAULT '',
  message_id      TEXT,                      -- RFC 5322 Message-ID
  headers         TEXT NOT NULL DEFAULT '{}',
  metadata        TEXT NOT NULL DEFAULT '{}',
  has_attachments INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  attachment_names TEXT NOT NULL DEFAULT '',
  attachment_search_text TEXT NOT NULL DEFAULT '',
  received_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- Outbound email queue
CREATE TABLE IF NOT EXISTS outbound_queue (
  id              TEXT PRIMARY KEY,
  from_mailbox    TEXT NOT NULL,
  to_addresses    TEXT NOT NULL,              -- JSON array
  subject         TEXT NOT NULL DEFAULT '',
  body_text       TEXT NOT NULL DEFAULT '',
  body_html       TEXT NOT NULL DEFAULT '',
  headers         TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sending','sent','failed')),
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- API tokens for authenticating local server requests
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash      TEXT PRIMARY KEY,          -- SHA-256 of the token
  label           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','revoked')),
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_queue(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON claim_challenges(expires_at);
`

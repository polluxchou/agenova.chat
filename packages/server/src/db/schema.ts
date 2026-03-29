// ---------------------------------------------------------------------------
// Agenova v1 — SQLite schema
// ---------------------------------------------------------------------------

export const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS agents (
  agent_id        TEXT PRIMARY KEY,
  email_address   TEXT UNIQUE NOT NULL,   -- local handle (e.g. alice@local)
  hosted_mailbox  TEXT UNIQUE,            -- bound @agenova.chat address, set after claim
  display_name    TEXT NOT NULL,
  public_key      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','revoked')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  mailbox_status  TEXT NOT NULL DEFAULT 'unclaimed'
                    CHECK (mailbox_status IN ('unclaimed','claimed','suspended')),
  claimed_at      TEXT,
  sync_cursor     TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  device_id          TEXT PRIMARY KEY,
  agent_id           TEXT NOT NULL REFERENCES agents(agent_id),
  device_name        TEXT NOT NULL,
  device_fingerprint TEXT UNIQUE NOT NULL,
  device_public_key  TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','revoked')),
  last_seen_at       TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_sessions (
  session_id        TEXT PRIMARY KEY,
  pairing_code      TEXT UNIQUE NOT NULL,
  agent_id          TEXT REFERENCES agents(agent_id),
  device_name       TEXT,
  device_public_key TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','expired')),
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_grants (
  grant_id      TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(agent_id),
  scope         TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  granted_by    TEXT NOT NULL,
  expires_at    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_envelopes (
  message_id      TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL,
  from_agent      TEXT NOT NULL REFERENCES agents(agent_id),
  to_agent        TEXT NOT NULL REFERENCES agents(agent_id),
  message_type    TEXT NOT NULL
                    CHECK (message_type IN ('task','reply','note','approval','system')),
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  headers         TEXT NOT NULL DEFAULT '{}',
  signature       TEXT NOT NULL,
  encryption_meta TEXT,
  scope           TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  memory_id          TEXT PRIMARY KEY,
  owner_agent_id     TEXT NOT NULL REFERENCES agents(agent_id),
  memory_type        TEXT NOT NULL
                       CHECK (memory_type IN ('conversation_summary','task_state','tool_result','fact','note')),
  title              TEXT NOT NULL,
  content_ciphertext TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  visibility         TEXT NOT NULL DEFAULT 'private'
                       CHECK (visibility IN ('private','shared','public')),
  tags               TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_keys (
  key_id           TEXT PRIMARY KEY,
  agent_id         TEXT NOT NULL REFERENCES agents(agent_id),
  provider         TEXT NOT NULL
                     CHECK (provider IN ('openai','anthropic','google','other')),
  alias            TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','revoked')),
  created_at       TEXT NOT NULL,
  last_used_at     TEXT,
  UNIQUE(agent_id, alias)
);

CREATE TABLE IF NOT EXISTS recovery_records (
  record_id      TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL UNIQUE REFERENCES agents(agent_id),
  encrypted_blob TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Inbound emails from the hosted @agenova.chat layer
-- Schema ported from mails (Category 1 reuse — owned here, not imported)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inbound_emails (
  id                    TEXT PRIMARY KEY,
  mailbox               TEXT NOT NULL,           -- e.g. alice@agenova.chat
  agent_id              TEXT REFERENCES agents(agent_id),
  from_address          TEXT NOT NULL,
  from_name             TEXT NOT NULL DEFAULT '',
  to_address            TEXT NOT NULL,
  subject               TEXT NOT NULL DEFAULT '',
  body_text             TEXT NOT NULL DEFAULT '',
  body_html             TEXT NOT NULL DEFAULT '',
  code                  TEXT,                     -- extracted verification code
  headers               TEXT NOT NULL DEFAULT '{}',
  metadata              TEXT NOT NULL DEFAULT '{}',
  message_id            TEXT,                     -- RFC 5322 Message-ID
  has_attachments       INTEGER NOT NULL DEFAULT 0,
  attachment_count      INTEGER NOT NULL DEFAULT 0,
  attachment_names      TEXT NOT NULL DEFAULT '',
  attachment_search_text TEXT NOT NULL DEFAULT '',
  direction             TEXT NOT NULL DEFAULT 'inbound'
                          CHECK (direction IN ('inbound','outbound')),
  status                TEXT NOT NULL DEFAULT 'received'
                          CHECK (status IN ('received','sent','failed','queued')),
  received_at           TEXT NOT NULL,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_attachments (
  id                       TEXT PRIMARY KEY,
  email_id                 TEXT NOT NULL REFERENCES inbound_emails(id),
  filename                 TEXT NOT NULL,
  content_type             TEXT NOT NULL,
  size_bytes               INTEGER,
  content_disposition      TEXT,
  content_id               TEXT,
  mime_part_index          INTEGER NOT NULL,
  text_content             TEXT NOT NULL DEFAULT '',
  text_extraction_status   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (text_extraction_status IN ('pending','done','unsupported','failed','too_large')),
  storage_key              TEXT,
  created_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_agent_id        ON devices(agent_id);
CREATE INDEX IF NOT EXISTS idx_grants_agent_scope      ON permission_grants(agent_id, scope);
CREATE INDEX IF NOT EXISTS idx_mail_from               ON mail_envelopes(from_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_to                 ON mail_envelopes(to_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_thread             ON mail_envelopes(thread_id);
CREATE INDEX IF NOT EXISTS idx_memory_owner            ON memory_items(owner_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_keys_agent        ON model_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_inbound_mailbox         ON inbound_emails(mailbox, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_agent           ON inbound_emails(agent_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_code            ON inbound_emails(mailbox) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_attachments_email ON email_attachments(email_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_message_id ON inbound_emails(message_id) WHERE message_id IS NOT NULL;
`

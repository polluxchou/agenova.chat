// ---------------------------------------------------------------------------
// Agenova v1 — shared domain types
// ---------------------------------------------------------------------------

export type AgentStatus = 'active' | 'suspended' | 'revoked'
export type DeviceStatus = 'pending' | 'active' | 'revoked'
export type PairingStatus = 'pending' | 'approved' | 'expired'
export type MessageType = 'task' | 'reply' | 'note' | 'approval' | 'system'
export type MemoryType = 'conversation_summary' | 'task_state' | 'tool_result' | 'fact' | 'note'
export type Visibility = 'private' | 'shared' | 'public'
export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'other'
export type ModelKeyStatus = 'active' | 'revoked'

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface Agent {
  agent_id: string
  email_address: string         // local handle (e.g. alice@local)
  hosted_mailbox?: string       // bound @agenova.chat address, set after claim
  display_name: string
  public_key: string            // "ed25519:<base64>"
  status: AgentStatus
  mailbox_status?: 'unclaimed' | 'claimed' | 'suspended'
  claimed_at?: string
  sync_cursor?: string
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

export interface Device {
  device_id: string
  agent_id: string
  device_name: string
  device_fingerprint: string    // SHA-256 of device public key
  device_public_key?: string    // optional per-device Ed25519 key
  status: DeviceStatus
  last_seen_at?: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Pairing session
// ---------------------------------------------------------------------------

export interface PairingSession {
  session_id: string
  pairing_code: string          // 6-digit numeric string
  agent_id?: string
  device_name?: string
  device_public_key?: string
  status: PairingStatus
  expires_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Permission grant
// ---------------------------------------------------------------------------

export interface PermissionGrant {
  grant_id: string
  agent_id: string
  scope: string                 // e.g. mail.read, memory.write, model.use
  resource_type?: string
  resource_id?: string
  granted_by: string            // agent_id of grantor
  expires_at?: string
  created_at: string
}

// Predefined scopes
export const SCOPES = {
  MAIL_READ: 'mail.read',
  MAIL_WRITE: 'mail.write',
  MEMORY_READ: 'memory.read',
  MEMORY_WRITE: 'memory.write',
  MODEL_USE: 'model.use',
  DEVICE_MANAGE: 'device.manage',
  IDENTITY_RESTORE: 'identity.restore',
} as const

// ---------------------------------------------------------------------------
// Mail envelope
// ---------------------------------------------------------------------------

export interface EncryptionMeta {
  algorithm: string             // e.g. "aes-256-gcm-x25519"
  recipient_key_id: string      // agent_id of recipient
}

export interface MailEnvelope {
  message_id: string
  thread_id: string
  from_agent: string
  to_agent: string
  message_type: MessageType
  subject: string
  body: string
  headers: Record<string, string>
  signature: string             // Ed25519 base64
  encryption_meta?: EncryptionMeta
  scope?: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Memory item
// ---------------------------------------------------------------------------

export interface MemoryItem {
  memory_id: string
  owner_agent_id: string
  memory_type: MemoryType
  title: string
  content_ciphertext: string    // AES-256-GCM encrypted, base64
  content_hash: string          // SHA-256 of plaintext
  visibility: Visibility
  tags: string[]
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Model key
// ---------------------------------------------------------------------------

export interface ModelKey {
  key_id: string
  agent_id: string
  provider: ModelProvider
  alias: string
  encrypted_secret: string      // AES-256-GCM encrypted, base64
  status: ModelKeyStatus
  created_at: string
  last_used_at?: string
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export interface RecoveryRecord {
  record_id: string
  agent_id: string
  encrypted_blob: string        // AES-256-GCM encrypted recovery bundle
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Inbound email (Category 1 — ported from mails, owned here)
// Field naming kept compatible with mails for design continuity.
// ---------------------------------------------------------------------------

export type AttachmentTextExtractionStatus =
  | 'pending'
  | 'done'
  | 'unsupported'
  | 'failed'
  | 'too_large'

export interface EmailAttachment {
  id: string
  email_id: string
  filename: string
  content_type: string
  size_bytes: number | null
  content_disposition: string | null
  content_id: string | null
  mime_part_index: number
  text_content: string
  text_extraction_status: AttachmentTextExtractionStatus
  storage_key: string | null
  created_at: string
}

export type EmailDirection = 'inbound' | 'outbound'
export type EmailStatus = 'received' | 'sent' | 'failed' | 'queued'

export interface InboundEmail {
  id: string
  mailbox: string                       // e.g. alice@agenova.chat
  agent_id?: string                     // bound agent, if known
  from_address: string
  from_name: string
  to_address: string
  subject: string
  body_text: string
  body_html: string
  code: string | null                   // extracted verification code
  headers: Record<string, string>
  metadata: Record<string, unknown>
  message_id: string | null
  has_attachments: boolean
  attachment_count: number
  attachment_names: string
  attachment_search_text: string
  direction: EmailDirection
  status: EmailStatus
  received_at: string
  created_at: string
  attachments?: EmailAttachment[]
}

// ---------------------------------------------------------------------------
// API context (attached to every verified request)
// ---------------------------------------------------------------------------

export interface AuthContext {
  agent_id: string
  public_key: string
}

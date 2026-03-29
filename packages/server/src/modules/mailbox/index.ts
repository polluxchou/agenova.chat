// ---------------------------------------------------------------------------
// Mailbox Service module
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { signMessage, verifySignature, randomUuid } from '../../crypto.js'
import { getAgentById } from '../identity/index.js'
import type { MailEnvelope, MessageType } from '../../types.js'

// ---------------------------------------------------------------------------
// Build + sign envelope
// ---------------------------------------------------------------------------

export interface SendMailInput {
  from_agent: string
  to_agent: string
  message_type: MessageType
  subject: string
  body: string
  thread_id?: string
  scope?: string
  headers?: Record<string, string>
  // Private key is passed in transiently — never stored by server
  from_private_key: string
  from_public_key_raw: string   // raw base64 (without "ed25519:" prefix)
}

/**
 * Build, sign, verify recipient exists, and persist the envelope.
 */
export function sendMail(input: SendMailInput): MailEnvelope {
  const sender = getAgentById(input.from_agent)
  if (!sender) throw new Error(`Sender agent ${input.from_agent} not found`)

  const recipient = getAgentById(input.to_agent)
  if (!recipient) throw new Error(`Recipient agent ${input.to_agent} not found`)

  const now = new Date().toISOString()
  const message_id = randomUuid()
  const thread_id = input.thread_id ?? randomUuid()

  // Build the payload that gets signed
  const payload = buildSigningPayload({ message_id, from_agent: input.from_agent, to_agent: input.to_agent, subject: input.subject, body: input.body, created_at: now })

  const signature = signMessage(payload, input.from_private_key, input.from_public_key_raw)

  const envelope: MailEnvelope = {
    message_id,
    thread_id,
    from_agent: input.from_agent,
    to_agent: input.to_agent,
    message_type: input.message_type,
    subject: input.subject,
    body: input.body,
    headers: { 'content-type': 'text/plain', ...input.headers },
    signature,
    scope: input.scope,
    created_at: now,
  }

  persistEnvelope(envelope)
  return envelope
}

// ---------------------------------------------------------------------------
// Verify envelope signature
// ---------------------------------------------------------------------------

export function verifyEnvelope(envelope: MailEnvelope): boolean {
  const sender = getAgentById(envelope.from_agent)
  if (!sender) return false

  const payload = buildSigningPayload({
    message_id: envelope.message_id,
    from_agent: envelope.from_agent,
    to_agent: envelope.to_agent,
    subject: envelope.subject,
    body: envelope.body,
    created_at: envelope.created_at,
  })

  return verifySignature(sender.public_key, payload, envelope.signature)
}

// ---------------------------------------------------------------------------
// Retrieve
// ---------------------------------------------------------------------------

export function getInbox(agent_id: string, limit = 20, offset = 0): MailEnvelope[] {
  return dbAll<MailEnvelope>(
    `SELECT * FROM mail_envelopes WHERE to_agent = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    agent_id, limit, offset,
  ).map(rowToEnvelope)
}

export function getOutbox(agent_id: string, limit = 20, offset = 0): MailEnvelope[] {
  return dbAll<MailEnvelope>(
    `SELECT * FROM mail_envelopes WHERE from_agent = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    agent_id, limit, offset,
  ).map(rowToEnvelope)
}

export function getEnvelope(message_id: string): MailEnvelope | null {
  const row = dbGet<Record<string, unknown>>('SELECT * FROM mail_envelopes WHERE message_id = ?', message_id)
  return row ? rowToEnvelope(row) : null
}

export function getThread(thread_id: string): MailEnvelope[] {
  return dbAll<Record<string, unknown>>(
    `SELECT * FROM mail_envelopes WHERE thread_id = ? ORDER BY created_at ASC`,
    thread_id,
  ).map(rowToEnvelope)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildSigningPayload(fields: {
  message_id: string
  from_agent: string
  to_agent: string
  subject: string
  body: string
  created_at: string
}): string {
  return JSON.stringify(fields)
}

function persistEnvelope(e: MailEnvelope): void {
  dbRun(
    `INSERT INTO mail_envelopes (message_id, thread_id, from_agent, to_agent, message_type, subject, body, headers, signature, encryption_meta, scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.message_id,
    e.thread_id,
    e.from_agent,
    e.to_agent,
    e.message_type,
    e.subject,
    e.body,
    JSON.stringify(e.headers),
    e.signature,
    e.encryption_meta ? JSON.stringify(e.encryption_meta) : null,
    e.scope ?? null,
    e.created_at,
  )
}

function rowToEnvelope(row: Record<string, unknown>): MailEnvelope {
  return {
    message_id: row.message_id as string,
    thread_id: row.thread_id as string,
    from_agent: row.from_agent as string,
    to_agent: row.to_agent as string,
    message_type: row.message_type as MessageType,
    subject: row.subject as string,
    body: row.body as string,
    headers: safeJsonParse(row.headers as string, {}),
    signature: row.signature as string,
    encryption_meta: row.encryption_meta ? safeJsonParse(row.encryption_meta as string, undefined) : undefined,
    scope: (row.scope as string) ?? undefined,
    created_at: row.created_at as string,
  }
}

function safeJsonParse<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

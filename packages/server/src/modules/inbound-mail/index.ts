// ---------------------------------------------------------------------------
// Inbound Mail module
//
// Category 1 — Ported from mails, owned by Agenova.
// Handles storage, queries, search, and verification-code extraction for
// emails received via the @agenova.chat hosted layer.
//
// Field naming kept compatible with mails for design continuity.
// No runtime dependency on the mails package.
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { randomUuid } from '../../crypto.js'
import type { InboundEmail, EmailAttachment, AttachmentTextExtractionStatus } from '../../types.js'

// ---------------------------------------------------------------------------
// Save (called by hosted-sync after fetching from hosted layer)
// ---------------------------------------------------------------------------

export function saveEmail(email: InboundEmail): void {
  dbRun(
    `INSERT OR IGNORE INTO inbound_emails
      (id, mailbox, agent_id, from_address, from_name, to_address, subject,
       body_text, body_html, code, headers, metadata, message_id,
       has_attachments, attachment_count, attachment_names, attachment_search_text,
       direction, status, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    email.id,
    email.mailbox,
    email.agent_id ?? null,
    email.from_address,
    email.from_name,
    email.to_address,
    email.subject,
    email.body_text,
    email.body_html,
    email.code ?? null,
    JSON.stringify(email.headers),
    JSON.stringify(email.metadata),
    email.message_id ?? null,
    email.has_attachments ? 1 : 0,
    email.attachment_count ?? 0,
    email.attachment_names ?? '',
    email.attachment_search_text ?? '',
    email.direction,
    email.status,
    email.received_at,
    email.created_at,
  )

  if (email.attachments?.length) {
    const stmt = dbRun  // will reuse same prepare pattern inline below
    for (const att of email.attachments) {
      dbRun(
        `INSERT OR IGNORE INTO email_attachments
          (id, email_id, filename, content_type, size_bytes, content_disposition,
           content_id, mime_part_index, text_content, text_extraction_status,
           storage_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        att.id,
        att.email_id,
        att.filename,
        att.content_type,
        att.size_bytes ?? null,
        att.content_disposition ?? null,
        att.content_id ?? null,
        att.mime_part_index,
        att.text_content ?? '',
        att.text_extraction_status ?? 'pending',
        att.storage_key ?? null,
        att.created_at,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Inbox listing  (Category 1 — ported from mails)
// ---------------------------------------------------------------------------

export interface QueryOptions {
  limit?: number
  offset?: number
  direction?: 'inbound' | 'outbound'
}

export function getEmails(mailbox: string, options: QueryOptions = {}): InboundEmail[] {
  const limit = normalizeLimit(options.limit)
  const offset = normalizeOffset(options.offset)

  let sql = `SELECT * FROM inbound_emails WHERE mailbox = ?`
  const params: unknown[] = [mailbox]

  if (options.direction) {
    sql += ` AND direction = ?`
    params.push(options.direction)
  }

  sql += ` ORDER BY received_at DESC LIMIT ? OFFSET ?`
  params.push(limit, offset)

  return dbAll<Record<string, unknown>>(sql, ...params).map(rowToEmail)
}

// ---------------------------------------------------------------------------
// Search  (Category 1 — ported from mails LIKE/NOCASE pattern)
// ---------------------------------------------------------------------------

export interface SearchOptions extends QueryOptions {
  query: string
}

export function searchEmails(mailbox: string, options: SearchOptions): InboundEmail[] {
  const limit = normalizeLimit(options.limit)
  const offset = normalizeOffset(options.offset)
  const escaped = escapelike(options.query)
  const pattern = `%${escaped}%`

  let sql = `SELECT * FROM inbound_emails WHERE mailbox = ?`
  const params: unknown[] = [mailbox]

  if (options.direction) {
    sql += ` AND direction = ?`
    params.push(options.direction)
  }

  sql += `
    AND (
      subject              LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR body_text         LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR from_address      LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR from_name         LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR attachment_search_text LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR code              LIKE ? ESCAPE '\\' COLLATE NOCASE
    )
    ORDER BY received_at DESC LIMIT ? OFFSET ?`

  params.push(pattern, pattern, pattern, pattern, pattern, pattern, limit, offset)

  return dbAll<Record<string, unknown>>(sql, ...params).map(rowToEmail)
}

// ---------------------------------------------------------------------------
// Get single email (with attachments)
// ---------------------------------------------------------------------------

export function getEmail(id: string): InboundEmail | null {
  const row = dbGet<Record<string, unknown>>(`SELECT * FROM inbound_emails WHERE id = ?`, id)
  if (!row) return null

  const email = rowToEmail(row)
  const attRows = dbAll<Record<string, unknown>>(
    `SELECT * FROM email_attachments WHERE email_id = ? ORDER BY mime_part_index ASC`,
    id,
  )
  email.attachments = attRows.map(rowToAttachment)
  return email
}

// ---------------------------------------------------------------------------
// Verification code extraction  (Category 1 — ported from mails waitForCode)
// Polls local DB for a recently received code email.
// ---------------------------------------------------------------------------

export interface WaitForCodeOptions {
  timeout?: number    // seconds (default 30)
  since?: string      // ISO timestamp — only look at emails after this time
}

export interface CodeResult {
  code: string
  from: string
  subject: string
}

export async function waitForCode(
  mailbox: string,
  options: WaitForCodeOptions = {},
): Promise<CodeResult | null> {
  const timeout = (options.timeout ?? 30) * 1000
  const since = options.since
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    let sql = `SELECT code, from_address, subject FROM inbound_emails
               WHERE mailbox = ? AND code IS NOT NULL`
    const params: unknown[] = [mailbox]

    if (since) {
      sql += ` AND received_at > ?`
      params.push(since)
    }

    sql += ` ORDER BY received_at DESC LIMIT 1`

    const row = dbGet<{ code: string; from_address: string; subject: string }>(sql, ...params)
    if (row) return { code: row.code, from: row.from_address, subject: row.subject }

    await new Promise(r => setTimeout(r, 1000))
  }

  return null
}

// ---------------------------------------------------------------------------
// Latest code (non-blocking, returns immediately)
// ---------------------------------------------------------------------------

export function getLatestCode(mailbox: string, since?: string): CodeResult | null {
  let sql = `SELECT code, from_address, subject FROM inbound_emails
             WHERE mailbox = ? AND code IS NOT NULL`
  const params: unknown[] = [mailbox]

  if (since) {
    sql += ` AND received_at > ?`
    params.push(since)
  }

  sql += ` ORDER BY received_at DESC LIMIT 1`
  const row = dbGet<{ code: string; from_address: string; subject: string }>(sql, ...params)
  return row ? { code: row.code, from: row.from_address, subject: row.subject } : null
}

// ---------------------------------------------------------------------------
// Attachment download
// ---------------------------------------------------------------------------

export interface AttachmentDownload {
  data: ArrayBuffer
  filename: string
  contentType: string
}

export function getAttachment(id: string): AttachmentDownload | null {
  const row = dbGet<{
    filename: string
    content_type: string
    text_content: string
    text_extraction_status: string
  }>(
    `SELECT filename, content_type, text_content, text_extraction_status
     FROM email_attachments WHERE id = ?`,
    id,
  )

  if (!row) return null
  if (row.text_extraction_status !== 'done' || !row.text_content) return null

  return {
    data: new TextEncoder().encode(row.text_content).buffer as ArrayBuffer,
    filename: row.filename,
    contentType: row.content_type,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToEmail(row: Record<string, unknown>): InboundEmail {
  return {
    id: row.id as string,
    mailbox: row.mailbox as string,
    agent_id: (row.agent_id as string) ?? undefined,
    from_address: row.from_address as string,
    from_name: (row.from_name as string) ?? '',
    to_address: row.to_address as string,
    subject: (row.subject as string) ?? '',
    body_text: (row.body_text as string) ?? '',
    body_html: (row.body_html as string) ?? '',
    code: (row.code as string) ?? null,
    headers: safeJson(row.headers as string, {}),
    metadata: safeJson(row.metadata as string, {}),
    message_id: (row.message_id as string) ?? null,
    has_attachments: !!(row.has_attachments as number),
    attachment_count: (row.attachment_count as number) ?? 0,
    attachment_names: (row.attachment_names as string) ?? '',
    attachment_search_text: (row.attachment_search_text as string) ?? '',
    direction: row.direction as 'inbound' | 'outbound',
    status: row.status as 'received' | 'sent' | 'failed' | 'queued',
    received_at: row.received_at as string,
    created_at: row.created_at as string,
  }
}

function rowToAttachment(row: Record<string, unknown>): EmailAttachment {
  return {
    id: row.id as string,
    email_id: row.email_id as string,
    filename: row.filename as string,
    content_type: row.content_type as string,
    size_bytes: (row.size_bytes as number) ?? null,
    content_disposition: (row.content_disposition as string) ?? null,
    content_id: (row.content_id as string) ?? null,
    mime_part_index: row.mime_part_index as number,
    text_content: (row.text_content as string) ?? '',
    text_extraction_status: (row.text_extraction_status as AttachmentTextExtractionStatus) ?? 'pending',
    storage_key: (row.storage_key as string) ?? null,
    created_at: row.created_at as string,
  }
}

function safeJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

function normalizeLimit(n?: number): number {
  return Number.isFinite(n) && n! > 0 ? Math.trunc(n!) : 20
}

function normalizeOffset(n?: number): number {
  return Number.isFinite(n) && n! >= 0 ? Math.trunc(n!) : 0
}

function escapelike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// ---------------------------------------------------------------------------
// Hosted Sync module  (Category 1 + 3 boundary)
//
// Category 1: Uses the same sync-to-local-storage pattern as mails
// Category 3: Agenova owns the local↔hosted handshake protocol
//             and the trust model (identity-bound, not token-only)
//
// Responsibilities:
//   - Poll the hosted @agenova.chat layer for new inbound emails
//   - Apply code extraction (ported from mails)
//   - Save emails into local inbound_emails table
//   - Track last-sync timestamp per mailbox
//   - Retry with exponential backoff on transient failures
// ---------------------------------------------------------------------------

import { dbGet, dbRun } from '../../db/client.js'
import { saveEmail } from '../inbound-mail/index.js'
import { getAgentByHostedMailbox } from '../mailbox-claim/index.js'
import { hostedRequest, getApiToken } from '../../hosted/client.js'
import type { InboundEmail } from '../../types.js'

const DEFAULT_POLL_INTERVAL_MS = 30_000   // 30 seconds

// ---------------------------------------------------------------------------
// Verification code extraction (Category 1 — ported from mails logic)
// ---------------------------------------------------------------------------

const CODE_PATTERNS = [
  /\b(\d{6})\b/,          // 6-digit code (most common)
  /\b(\d{4})\b/,          // 4-digit code
  /\b(\d{8})\b/,          // 8-digit code
  /code[:\s]+\b([A-Z0-9]*\d[A-Z0-9]*)\b/i,          // alphanumeric with at least one digit
  /verification[:\s]+\b([A-Z0-9]*\d[A-Z0-9]*)\b/i,   // same
  /token[:\s]+\b([A-Z0-9]*\d[A-Z0-9]*)\b/i,          // same
]

export function extractCode(subject: string, body: string): string | null {
  const text = `${subject} ${body}`
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

// ---------------------------------------------------------------------------
// Sync a single mailbox
// ---------------------------------------------------------------------------

function getSyncCursor(mailbox: string): string | null {
  const agent = dbGet<{ sync_cursor: string | null }>(
    `SELECT sync_cursor FROM agents WHERE hosted_mailbox = ?`,
    mailbox,
  )
  if (agent?.sync_cursor) return agent.sync_cursor

  // Fallback: derive from existing emails (handles first run after schema upgrade)
  const row = dbGet<{ last_synced_at: string | null }>(
    `SELECT MAX(received_at) as last_synced_at FROM inbound_emails WHERE mailbox = ?`,
    mailbox,
  )
  return row?.last_synced_at ?? null
}

function updateSyncCursor(mailbox: string, cursor: string): void {
  dbRun(
    `UPDATE agents SET sync_cursor = ?, updated_at = ? WHERE hosted_mailbox = ?`,
    cursor, new Date().toISOString(), mailbox,
  )
}

export async function syncMailbox(mailbox: string, api_token: string): Promise<number> {
  const since = getSyncCursor(mailbox)

  const queryParams = new URLSearchParams({ mailbox, limit: '50' })
  if (since) queryParams.set('since', since)

  let res
  try {
    res = await hostedRequest<{ emails: RemoteEmail[] }>({
      method: 'GET',
      path: `/v1/inbox?${queryParams.toString()}`,
      token: api_token,
      retries: 1,
      retryDelayMs: 500,
    })
  } catch (err) {
    console.error(`[hosted-sync] Failed to fetch inbox for ${mailbox}:`, err)
    return 0
  }

  if (!res.ok) {
    console.error(`[hosted-sync] Failed to fetch inbox for ${mailbox}: ${res.status}`)
    return 0
  }

  const emails = res.data?.emails ?? []

  for (const remote of emails) {
    const code = extractCode(remote.subject ?? '', remote.body_text ?? '')
    const agent = getAgentByHostedMailbox(remote.to_address)

    const email: InboundEmail = {
      id: remote.id,
      mailbox: remote.to_address ?? mailbox,
      agent_id: agent?.agent_id,
      from_address: remote.from_address,
      from_name: remote.from_name ?? '',
      to_address: remote.to_address,
      subject: remote.subject ?? '',
      body_text: remote.body_text ?? '',
      body_html: remote.body_html ?? '',
      code,
      headers: remote.headers ?? {},
      metadata: remote.metadata ?? {},
      message_id: remote.message_id ?? null,
      has_attachments: !!(remote.attachment_count && remote.attachment_count > 0),
      attachment_count: remote.attachment_count ?? 0,
      attachment_names: remote.attachment_names ?? '',
      attachment_search_text: remote.attachment_search_text ?? '',
      direction: 'inbound',
      status: 'received',
      received_at: remote.received_at,
      created_at: remote.created_at ?? remote.received_at,
    }

    saveEmail(email)
  }

  if (emails.length > 0) {
    const maxCursor = emails.reduce(
      (max, e) => (e.received_at > max ? e.received_at : max),
      emails[0].received_at,
    )
    updateSyncCursor(mailbox, maxCursor)
    console.log(`[hosted-sync] Synced ${emails.length} email(s) for ${mailbox}`)
  }

  return emails.length
}

// ---------------------------------------------------------------------------
// Send outbound email via hosted layer
// ---------------------------------------------------------------------------

export interface SendMailHostedInput {
  from: string            // e.g. alice@agenova.chat
  to: string | string[]
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
}

export interface SendMailHostedResult {
  id: string
}

export async function sendMailHosted(input: SendMailHostedInput): Promise<SendMailHostedResult> {
  const token = getApiToken()
  if (!token) throw new Error('AGENOVA_API_TOKEN not configured — cannot send via hosted')

  const res = await hostedRequest<{ id: string }>({
    method: 'POST',
    path: '/v1/send',
    token,
    body: {
      from: input.from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: input.headers,
    },
    retries: 1,
    retryDelayMs: 500,
  })

  if (!res.ok) {
    const msg = (res.data as { message?: string })?.message ?? `status ${res.status}`
    throw new Error(`Failed to send mail via hosted: ${msg}`)
  }

  return res.data
}

// ---------------------------------------------------------------------------
// Sync all bound mailboxes
// ---------------------------------------------------------------------------

export async function syncAll(): Promise<void> {
  const apiToken = getApiToken()
  if (!apiToken) {
    // Silent when no token — expected in local-only dev
    return
  }

  const { dbAll } = await import('../../db/client.js')
  const agents = dbAll<{ hosted_mailbox: string }>(
    `SELECT hosted_mailbox FROM agents WHERE hosted_mailbox IS NOT NULL AND status = 'active'`,
  )

  for (const { hosted_mailbox } of agents) {
    try {
      await syncMailbox(hosted_mailbox, apiToken)
    } catch (err) {
      console.error(`[hosted-sync] Error syncing ${hosted_mailbox}:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

let _pollTimer: ReturnType<typeof setInterval> | null = null

export function startSyncLoop(
  intervalMs = Number(process.env.AGENOVA_SYNC_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS,
): void {
  if (_pollTimer) return

  const apiToken = getApiToken()
  if (!apiToken) return  // don't start loop without token

  console.log(`[hosted-sync] Starting poll loop every ${intervalMs / 1000}s`)
  syncAll().catch(console.error)
  _pollTimer = setInterval(() => syncAll().catch(console.error), intervalMs)
}

export function stopSyncLoop(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

/** Test reset hook */
export function _resetSyncLoop(): void {
  stopSyncLoop()
}

// ---------------------------------------------------------------------------
// Remote email shape (from hosted API)
// ---------------------------------------------------------------------------

interface RemoteEmail {
  id: string
  from_address: string
  from_name?: string
  to_address: string
  subject?: string
  body_text?: string
  body_html?: string
  headers?: Record<string, string>
  metadata?: Record<string, unknown>
  message_id?: string
  attachment_count?: number
  attachment_names?: string
  attachment_search_text?: string
  received_at: string
  created_at?: string
}

// ---------------------------------------------------------------------------
// Inbox route — serves emails to local servers via polling
//
// GET /v1/inbox?mailbox=alice@agenova.chat&since=&limit=
//
// Returns emails for a given mailbox, optionally filtered by since= timestamp.
// Requires Bearer token authentication.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { dbAll } from '../db/client.js'
import { bearerAuth } from '../middleware/auth.js'

const router = new Hono()

router.get('/inbox', bearerAuth, (c) => {
  const mailbox = c.req.query('mailbox')
  if (!mailbox) {
    return c.json({ message: 'Query param ?mailbox= required', code: 'MISSING_FIELDS' }, 400)
  }

  const since = c.req.query('since')
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)

  let sql = `SELECT * FROM emails WHERE mailbox = ?`
  const params: unknown[] = [mailbox]

  if (since) {
    sql += ` AND received_at > ?`
    params.push(since)
  }

  sql += ` ORDER BY received_at ASC LIMIT ?`
  params.push(limit)

  const emails = dbAll<Record<string, unknown>>(sql, ...params).map(row => ({
    id: row.id,
    from_address: row.from_address,
    from_name: row.from_name ?? '',
    to_address: row.to_address,
    subject: row.subject ?? '',
    body_text: row.body_text ?? '',
    body_html: row.body_html ?? '',
    message_id: row.message_id ?? null,
    headers: safeJson(row.headers as string, {}),
    metadata: safeJson(row.metadata as string, {}),
    has_attachments: !!(row.has_attachments as number),
    attachment_count: row.attachment_count ?? 0,
    attachment_names: row.attachment_names ?? '',
    attachment_search_text: row.attachment_search_text ?? '',
    received_at: row.received_at,
    created_at: row.created_at,
  }))

  return c.json({ emails })
})

function safeJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

export default router

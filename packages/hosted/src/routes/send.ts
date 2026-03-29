// ---------------------------------------------------------------------------
// Outbound send route
//
// POST /v1/send
//
// Queues an outbound email for delivery. In production, a background worker
// picks up queued items and delivers via the configured email provider
// (Resend, Mailgun, SES, etc.).
//
// Requires Bearer token authentication.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { dbRun } from '../db/client.js'
import { bearerAuth } from '../middleware/auth.js'
import { randomUuid } from '../crypto.js'

const router = new Hono()

router.post('/send', bearerAuth, async (c) => {
  const body = await c.req.json<{
    from: string
    to: string[]
    subject?: string
    text?: string
    html?: string
    headers?: Record<string, string>
  }>()

  if (!body.from || !body.to?.length) {
    return c.json({ message: 'from and to are required', code: 'MISSING_FIELDS' }, 400)
  }

  const id = randomUuid()
  const now = new Date().toISOString()

  dbRun(
    `INSERT INTO outbound_queue (id, from_mailbox, to_addresses, subject, body_text, body_html, headers, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    id,
    body.from,
    JSON.stringify(body.to),
    body.subject ?? '',
    body.text ?? '',
    body.html ?? '',
    JSON.stringify(body.headers ?? {}),
    now,
    now,
  )

  return c.json({ id })
})

export default router

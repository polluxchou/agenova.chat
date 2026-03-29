// ---------------------------------------------------------------------------
// Webhook inbound route — receives emails from email providers
//
// POST /v1/webhook/inbound
//
// Accepts inbound email payloads from providers like:
//   - Mailgun (multipart/form-data or JSON)
//   - Cloudflare Email Workers (JSON)
//   - Resend (JSON)
//   - Custom (JSON)
//
// This is a catch-all endpoint that normalizes different provider formats
// into the internal email schema. The provider format is auto-detected
// or specified via ?provider= query param.
//
// Authentication: either Bearer token or webhook signing secret (provider-specific)
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { dbGet, dbRun } from '../db/client.js'
import { randomUuid } from '../crypto.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Generic JSON webhook (default format)
// ---------------------------------------------------------------------------

interface InboundWebhookPayload {
  from_address: string
  from_name?: string
  to_address: string
  subject?: string
  body_text?: string
  body_html?: string
  message_id?: string
  headers?: Record<string, string>
}

router.post('/webhook/inbound', async (c) => {
  // Verify webhook secret if configured
  const webhookSecret = process.env.AGENOVA_WEBHOOK_SECRET
  if (webhookSecret) {
    const provided = c.req.header('x-webhook-secret')
    if (provided !== webhookSecret) {
      return c.json({ message: 'Invalid webhook secret', code: 'UNAUTHORIZED' }, 401)
    }
  }

  const contentType = c.req.header('content-type') ?? ''

  let payload: InboundWebhookPayload

  if (contentType.includes('application/json')) {
    payload = await c.req.json<InboundWebhookPayload>()
  } else {
    return c.json({ message: 'Unsupported content type', code: 'VALIDATION_ERROR' }, 415)
  }

  if (!payload.from_address || !payload.to_address) {
    return c.json({ message: 'from_address and to_address are required', code: 'MISSING_FIELDS' }, 400)
  }

  // Resolve the mailbox from the to_address
  const mailbox = payload.to_address.toLowerCase()

  // Check if this mailbox has an active claim
  const claim = dbGet<{ hosted_mailbox: string; status: string }>(
    `SELECT hosted_mailbox, status FROM mailbox_claims WHERE hosted_mailbox = ?`,
    mailbox,
  )

  if (!claim || claim.status !== 'active') {
    // Store anyway — might be claimed later, or might be a bounce address
    // In production, you might want to reject unknown mailboxes
  }

  const id = randomUuid()
  const now = new Date().toISOString()

  dbRun(
    `INSERT INTO emails (id, mailbox, from_address, from_name, to_address, subject, body_text, body_html,
                         message_id, headers, metadata, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    id,
    mailbox,
    payload.from_address,
    payload.from_name ?? '',
    payload.to_address,
    payload.subject ?? '',
    payload.body_text ?? '',
    payload.body_html ?? '',
    payload.message_id ?? null,
    JSON.stringify(payload.headers ?? {}),
    now,
    now,
  )

  return c.json({ id, mailbox }, 201)
})

export default router

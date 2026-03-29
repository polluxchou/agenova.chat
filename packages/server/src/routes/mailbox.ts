// ---------------------------------------------------------------------------
// Mailbox routes
// POST /v1/mail/send
// GET  /v1/agents/:agentId/mail/inbox
// GET  /v1/agents/:agentId/mail/outbox
// GET  /v1/mail/:messageId
// GET  /v1/mail/threads/:threadId
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { sendMail, getInbox, getOutbox, getEnvelope, getThread, verifyEnvelope } from '../modules/mailbox/index.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireScope } from '../middleware/policy-guard.js'
import { SCOPES } from '../types.js'
import type { MessageType } from '../types.js'

const router = new Hono()

// Send mail
router.post('/mail/send', authMiddleware, requireScope(SCOPES.MAIL_WRITE), async (c) => {
  const body = await c.req.json<{
    to_agent: string
    message_type: MessageType
    subject: string
    body: string
    thread_id?: string
    scope?: string
    headers?: Record<string, string>
    // Caller must provide their private key transiently for signing
    from_private_key: string
    from_public_key_raw: string
  }>()

  const from_agent = c.get('agent_id') as string

  const required = ['to_agent', 'message_type', 'subject', 'body', 'from_private_key', 'from_public_key_raw']
  const missing = required.filter(k => !body[k as keyof typeof body])
  if (missing.length) return c.json({ error: `Missing fields: ${missing.join(', ')}`, code: 'MISSING_FIELDS' }, 400)

  try {
    const envelope = sendMail({ ...body, from_agent })
    return c.json({ envelope }, 201)
  } catch (err) {
    return c.json({ error: String(err), code: 'SEND_FAILED' }, 400)
  }
})

// Inbox
router.get('/agents/:agentId/mail/inbox', authMiddleware, requireScope(SCOPES.MAIL_READ), (c) => {
  const agentId = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string

  if (requesterId !== agentId) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const limit = Number(c.req.query('limit') ?? 20)
  const offset = Number(c.req.query('offset') ?? 0)
  const messages = getInbox(agentId, limit, offset)
  return c.json({ messages })
})

// Outbox
router.get('/agents/:agentId/mail/outbox', authMiddleware, requireScope(SCOPES.MAIL_READ), (c) => {
  const agentId = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string

  if (requesterId !== agentId) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const limit = Number(c.req.query('limit') ?? 20)
  const offset = Number(c.req.query('offset') ?? 0)
  const messages = getOutbox(agentId, limit, offset)
  return c.json({ messages })
})

// Single message
router.get('/mail/:messageId', authMiddleware, (c) => {
  const envelope = getEnvelope(c.req.param('messageId'))
  if (!envelope) return c.json({ error: 'Message not found', code: 'NOT_FOUND' }, 404)

  const requesterId = c.get('agent_id') as string
  if (envelope.from_agent !== requesterId && envelope.to_agent !== requesterId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
  }

  const verified = verifyEnvelope(envelope)
  return c.json({ envelope, verified })
})

// Thread
router.get('/mail/threads/:threadId', authMiddleware, (c) => {
  const messages = getThread(c.req.param('threadId'))
  const requesterId = c.get('agent_id') as string

  // Filter to only messages the requester is part of
  const visible = messages.filter(m => m.from_agent === requesterId || m.to_agent === requesterId)
  return c.json({ messages: visible })
})

export default router

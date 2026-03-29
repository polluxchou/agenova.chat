// ---------------------------------------------------------------------------
// Inbound mail routes  (external email via @agenova.chat)
//
// POST /v1/agents/:agentId/mailbox/claim
// DELETE /v1/agents/:agentId/mailbox
// GET  /v1/agents/:agentId/inbox
// GET  /v1/agents/:agentId/inbox/search
// GET  /v1/agents/:agentId/inbox/:emailId
// GET  /v1/agents/:agentId/inbox/code
// GET  /v1/attachments/:attachmentId
// POST /v1/agents/:agentId/inbox/sync   (manual trigger)
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import { requireScope } from '../middleware/policy-guard.js'
import { SCOPES } from '../types.js'
import { getEmails, searchEmails, getEmail, waitForCode, getLatestCode, getAttachment } from '../modules/inbound-mail/index.js'
import { claimMailboxAuto, releaseMailbox } from '../modules/mailbox-claim/index.js'
import { syncMailbox } from '../modules/hosted-sync/index.js'
import { getAgentById } from '../modules/identity/index.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Mailbox claim  (Category 3 — Agenova owns this)
// POST /v1/agents/:agentId/mailbox/claim
// ---------------------------------------------------------------------------
router.post('/agents/:agentId/mailbox/claim', authMiddleware, async (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = await c.req.json<{
    handle: string
    private_key_seed: string
    public_key_raw: string
  }>()

  if (!body.handle || !body.private_key_seed || !body.public_key_raw) {
    return c.json({ error: 'handle, private_key_seed, and public_key_raw are required', code: 'MISSING_FIELDS' }, 400)
  }

  try {
    const result = await claimMailboxAuto({ agent_id, ...body })
    return c.json(result, 201)
  } catch (err) {
    return c.json({ error: String(err), code: 'SEND_FAILED' }, 400)
  }
})

// ---------------------------------------------------------------------------
// Mailbox release
// DELETE /v1/agents/:agentId/mailbox
// ---------------------------------------------------------------------------
router.delete('/agents/:agentId/mailbox', authMiddleware, async (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = await c.req.json<{ private_key_seed: string; public_key_raw: string }>()
  if (!body.private_key_seed || !body.public_key_raw) {
    return c.json({ error: 'private_key_seed and public_key_raw are required', code: 'MISSING_FIELDS' }, 400)
  }

  try {
    await releaseMailbox(agent_id, body.private_key_seed, body.public_key_raw)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: String(err), code: 'SEND_FAILED' }, 400)
  }
})

// ---------------------------------------------------------------------------
// Inbox listing  (Category 1)
// GET /v1/agents/:agentId/inbox
// ---------------------------------------------------------------------------
router.get('/agents/:agentId/inbox', authMiddleware, requireScope(SCOPES.MAIL_READ), (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  // Derive the hosted mailbox from the agent record

  const agent = getAgentById(agent_id)
  if (!agent?.hosted_mailbox) return c.json({ error: 'No hosted mailbox bound', code: 'NO_MAILBOX' }, 404)

  const emails = getEmails(agent.hosted_mailbox, {
    limit: Number(c.req.query('limit') ?? 20),
    offset: Number(c.req.query('offset') ?? 0),
    direction: c.req.query('direction') as 'inbound' | 'outbound' | undefined,
  })

  return c.json({ emails })
})

// ---------------------------------------------------------------------------
// Search  (Category 1)
// GET /v1/agents/:agentId/inbox/search?q=...
// ---------------------------------------------------------------------------
router.get('/agents/:agentId/inbox/search', authMiddleware, requireScope(SCOPES.MAIL_READ), (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const q = c.req.query('q')
  if (!q) return c.json({ error: 'Query param ?q= required', code: 'MISSING_FIELDS' }, 400)


  const agent = getAgentById(agent_id)
  if (!agent?.hosted_mailbox) return c.json({ error: 'No hosted mailbox bound', code: 'NO_MAILBOX' }, 404)

  const emails = searchEmails(agent.hosted_mailbox, {
    query: q,
    limit: Number(c.req.query('limit') ?? 20),
    offset: Number(c.req.query('offset') ?? 0),
  })

  return c.json({ emails })
})

// ---------------------------------------------------------------------------
// Verification code  (Category 1)
// GET /v1/agents/:agentId/inbox/code?since=&wait=
// IMPORTANT: Must be defined BEFORE /:emailId to avoid "code" matching as emailId
// ---------------------------------------------------------------------------
router.get('/agents/:agentId/inbox/code', authMiddleware, requireScope(SCOPES.MAIL_READ), async (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)


  const agent = getAgentById(agent_id)
  if (!agent?.hosted_mailbox) return c.json({ error: 'No hosted mailbox bound', code: 'NO_MAILBOX' }, 404)

  const since = c.req.query('since')
  const shouldWait = c.req.query('wait') === 'true'
  const timeout = Number(c.req.query('timeout') ?? 30)

  const result = shouldWait
    ? await waitForCode(agent.hosted_mailbox, { since, timeout })
    : getLatestCode(agent.hosted_mailbox, since)

  if (!result) return c.json({ code: null })
  return c.json(result)
})

// ---------------------------------------------------------------------------
// Single email
// GET /v1/agents/:agentId/inbox/:emailId
// (Defined AFTER /inbox/code and /inbox/search so those don't match as emailId)
// ---------------------------------------------------------------------------
router.get('/agents/:agentId/inbox/:emailId', authMiddleware, requireScope(SCOPES.MAIL_READ), (c) => {
  const email = getEmail(c.req.param('emailId'))
  if (!email) return c.json({ error: 'Email not found', code: 'NOT_FOUND' }, 404)

  const requesterId = c.get('agent_id') as string
  const agent = getAgentById(requesterId)
  if (email.mailbox !== agent?.hosted_mailbox) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  return c.json({ email })
})

// ---------------------------------------------------------------------------
// Attachment download
// GET /v1/attachments/:attachmentId
// ---------------------------------------------------------------------------
router.get('/attachments/:attachmentId', authMiddleware, (c) => {
  const att = getAttachment(c.req.param('attachmentId'))
  if (!att) return c.json({ error: 'Attachment not found or not extracted' }, 404)

  return new Response(att.data, {
    headers: {
      'Content-Type': att.contentType,
      'Content-Disposition': `attachment; filename="${att.filename}"`,
    },
  })
})

// ---------------------------------------------------------------------------
// Manual sync trigger
// POST /v1/agents/:agentId/inbox/sync
// ---------------------------------------------------------------------------
router.post('/agents/:agentId/inbox/sync', authMiddleware, async (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)


  const agent = getAgentById(agent_id)
  if (!agent?.hosted_mailbox) return c.json({ error: 'No hosted mailbox bound', code: 'NO_MAILBOX' }, 404)

  const apiToken = process.env.AGENOVA_API_TOKEN
  if (!apiToken) return c.json({ error: 'AGENOVA_API_TOKEN not configured on server', code: 'TOKEN_MISSING' }, 503)

  const count = await syncMailbox(agent.hosted_mailbox, apiToken)
  return c.json({ synced: count })
})

export default router

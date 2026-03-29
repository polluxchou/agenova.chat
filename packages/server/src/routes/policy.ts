// ---------------------------------------------------------------------------
// Policy routes
// POST   /v1/agents/:agentId/grants
// DELETE /v1/agents/:agentId/grants/:grantId
// GET    /v1/agents/:agentId/grants
// POST   /v1/policy/check
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { grantScope, revokeGrant, listGrants, checkPermission } from '../modules/policy/index.js'
import { authMiddleware } from '../middleware/auth.js'

const router = new Hono()

// Grant a scope
router.post('/agents/:agentId/grants', authMiddleware, async (c) => {
  const body = await c.req.json<{
    scope: string
    resource_type?: string
    resource_id?: string
    expires_at?: string
  }>()

  if (!body.scope) return c.json({ error: 'scope is required', code: 'MISSING_FIELDS' }, 400)

  const agent_id = c.req.param('agentId')
  const granted_by = c.get('agent_id') as string

  const grant = grantScope({
    agent_id,
    scope: body.scope,
    resource_type: body.resource_type,
    resource_id: body.resource_id,
    granted_by,
    expires_at: body.expires_at,
  })

  return c.json({ grant }, 201)
})

// Revoke a grant
router.delete('/agents/:agentId/grants/:grantId', authMiddleware, (c) => {
  revokeGrant(c.req.param('grantId'))
  return c.json({ ok: true })
})

// List grants for agent
router.get('/agents/:agentId/grants', authMiddleware, (c) => {
  const grants = listGrants(c.req.param('agentId'))
  return c.json({ grants })
})

// Check permission
router.post('/policy/check', authMiddleware, async (c) => {
  const body = await c.req.json<{
    agent_id: string
    scope: string
    resource_type?: string
    resource_id?: string
  }>()

  if (!body.agent_id || !body.scope) {
    return c.json({ error: 'agent_id and scope are required', code: 'MISSING_FIELDS' }, 400)
  }

  const allowed = checkPermission(body)
  return c.json({ allowed })
})

export default router

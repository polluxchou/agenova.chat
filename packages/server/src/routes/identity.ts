// ---------------------------------------------------------------------------
// Identity routes
// POST   /v1/agents
// GET    /v1/agents/:agentId
// GET    /v1/agents?email=
// DELETE /v1/agents/:agentId/devices/:deviceId
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { createAgent, getAgentById, getAgentByEmail, revokeAgent } from '../modules/identity/index.js'
import { revokeDevice } from '../modules/device/index.js'
import { authMiddleware } from '../middleware/auth.js'

const router = new Hono()

// Create agent (no auth — bootstrap endpoint)
router.post('/', async (c) => {
  const body = await c.req.json<{ email_address: string; display_name: string }>()

  if (!body.email_address || !body.display_name) {
    return c.json({ error: 'email_address and display_name are required', code: 'MISSING_FIELDS' }, 400)
  }

  try {
    const result = createAgent({ email_address: body.email_address, display_name: body.display_name })
    // private_key is returned once here and never stored
    return c.json(result, 201)
  } catch (err) {
    return c.json({ error: 'Agent with this email already exists', code: 'DUPLICATE' }, 409)
  }
})

// Get agent by ID
router.get('/:agentId', authMiddleware, (c) => {
  const agent = getAgentById(c.req.param('agentId'))
  if (!agent) return c.json({ error: 'Agent not found', code: 'NOT_FOUND' }, 404)
  return c.json({ agent })
})

// Get agent by email  (?email=...)
router.get('/', authMiddleware, (c) => {
  const email = c.req.query('email')
  if (!email) return c.json({ error: 'Query param ?email= required', code: 'MISSING_FIELDS' }, 400)

  const agent = getAgentByEmail(email)
  if (!agent) return c.json({ error: 'Agent not found', code: 'NOT_FOUND' }, 404)
  return c.json({ agent })
})

// Revoke a device belonging to an agent
router.delete('/:agentId/devices/:deviceId', authMiddleware, (c) => {
  const requesterId = c.get('agent_id') as string
  const agentId = c.req.param('agentId')

  if (requesterId !== agentId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
  }

  revokeDevice(c.req.param('deviceId'))
  return c.json({ ok: true })
})

export default router

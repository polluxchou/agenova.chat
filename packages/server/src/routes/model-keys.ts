// ---------------------------------------------------------------------------
// Model Key Broker routes
// POST   /v1/agents/:agentId/model-keys
// GET    /v1/agents/:agentId/model-keys
// DELETE /v1/agents/:agentId/model-keys/:alias
// POST   /v1/agents/:agentId/model-keys/:alias/invoke
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { storeModelKey, listModelKeys, revokeModelKey, invokeModel } from '../modules/model-keys/index.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireScope } from '../middleware/policy-guard.js'
import { SCOPES } from '../types.js'
import type { ModelProvider } from '../types.js'

const router = new Hono()

// Store key
router.post('/agents/:agentId/model-keys', authMiddleware, async (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = await c.req.json<{ provider: ModelProvider; alias: string; secret: string }>()
  if (!body.provider || !body.alias || !body.secret) {
    return c.json({ error: 'provider, alias, and secret are required', code: 'MISSING_FIELDS' }, 400)
  }

  try {
    const key = storeModelKey({ agent_id, ...body })
    // Never return the secret
    const { encrypted_secret: _, ...safe } = key
    return c.json({ key: safe }, 201)
  } catch (err) {
    return c.json({ error: String(err), code: 'DUPLICATE' }, 409)
  }
})

// List keys
router.get('/agents/:agentId/model-keys', authMiddleware, (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const keys = listModelKeys(agent_id)
  return c.json({ keys })
})

// Revoke key
router.delete('/agents/:agentId/model-keys/:alias', authMiddleware, (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  revokeModelKey(agent_id, c.req.param('alias'))
  return c.json({ ok: true })
})

// Invoke (proxy model call)
router.post('/agents/:agentId/model-keys/:alias/invoke', authMiddleware, requireScope(SCOPES.MODEL_USE), async (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden' }, 403)

  const payload = await c.req.json()

  try {
    const result = await invokeModel({ agent_id, alias: c.req.param('alias'), payload })
    return c.json(result, result.ok ? 200 : 502)
  } catch (err) {
    return c.json({ error: String(err), code: 'NOT_FOUND' }, 400)
  }
})

export default router

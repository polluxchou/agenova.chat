// ---------------------------------------------------------------------------
// Memory routes
// POST   /v1/agents/:agentId/memory
// GET    /v1/agents/:agentId/memory
// PATCH  /v1/memory/:memoryId
// DELETE /v1/memory/:memoryId
// POST   /v1/memory/:memoryId/share
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { appendMemory, getMemory, updateMemory, deleteMemory, shareMemory } from '../modules/memory/index.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireScope } from '../middleware/policy-guard.js'
import { SCOPES } from '../types.js'
import type { MemoryType, Visibility } from '../types.js'

const router = new Hono()

// Append
router.post('/agents/:agentId/memory', authMiddleware, requireScope(SCOPES.MEMORY_WRITE), async (c) => {
  const owner_agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== owner_agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = await c.req.json<{
    memory_type: MemoryType
    title: string
    content: string
    visibility?: Visibility
    tags?: string[]
  }>()

  if (!body.memory_type || !body.title || !body.content) {
    return c.json({ error: 'memory_type, title, and content are required', code: 'MISSING_FIELDS' }, 400)
  }

  const item = appendMemory({ owner_agent_id, ...body })
  return c.json({ item }, 201)
})

// Query
router.get('/agents/:agentId/memory', authMiddleware, requireScope(SCOPES.MEMORY_READ), (c) => {
  const owner_agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== owner_agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const items = getMemory(owner_agent_id, {
    memory_type: c.req.query('type') as MemoryType | undefined,
    visibility: c.req.query('visibility') as Visibility | undefined,
    search: c.req.query('q'),
    limit: Number(c.req.query('limit') ?? 20),
    offset: Number(c.req.query('offset') ?? 0),
  })

  return c.json({ items })
})

// Update
router.patch('/memory/:memoryId', authMiddleware, requireScope(SCOPES.MEMORY_WRITE), async (c) => {
  const body = await c.req.json()
  try {
    const item = updateMemory(c.req.param('memoryId'), body)
    return c.json({ item })
  } catch (err) {
    return c.json({ error: String(err), code: 'NOT_FOUND' }, 404)
  }
})

// Delete
router.delete('/memory/:memoryId', authMiddleware, requireScope(SCOPES.MEMORY_WRITE), (c) => {
  deleteMemory(c.req.param('memoryId'))
  return c.json({ ok: true })
})

// Share
router.post('/memory/:memoryId/share', authMiddleware, requireScope(SCOPES.MEMORY_WRITE), (c) => {
  shareMemory(c.req.param('memoryId'))
  return c.json({ ok: true })
})

export default router

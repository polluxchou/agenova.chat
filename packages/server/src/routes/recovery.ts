// ---------------------------------------------------------------------------
// Recovery routes
// POST /v1/agents/:agentId/recovery
// GET  /v1/agents/:agentId/recovery/export
// POST /v1/agents/:agentId/recovery/restore
// POST /v1/recovery/import
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import {
  createRecoveryPack,
  exportEncryptedBackup,
  restoreIdentity,
  importEncryptedBackup,
} from '../modules/recovery/index.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireScope } from '../middleware/policy-guard.js'
import { SCOPES } from '../types.js'

const router = new Hono()

// Create recovery pack
router.post('/agents/:agentId/recovery', authMiddleware, async (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const body = await c.req.json<{ private_key_seed: string }>()
  if (!body.private_key_seed) return c.json({ error: 'private_key_seed is required', code: 'MISSING_FIELDS' }, 400)

  try {
    const result = createRecoveryPack({ agent_id, private_key_seed: body.private_key_seed })
    return c.json(result, 201)
  } catch (err) {
    return c.json({ error: String(err), code: 'RESTORE_FAILED' }, 400)
  }
})

// Export encrypted backup blob
router.get('/agents/:agentId/recovery/export', authMiddleware, (c) => {
  const agent_id = c.req.param('agentId')
  const requesterId = c.get('agent_id') as string
  if (requesterId !== agent_id) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  try {
    const blob = exportEncryptedBackup(agent_id)
    return c.json({ blob })
  } catch (err) {
    return c.json({ error: String(err), code: 'NOT_FOUND' }, 404)
  }
})

// Restore identity using recovery code
router.post('/agents/:agentId/recovery/restore', requireScope(SCOPES.IDENTITY_RESTORE), async (c) => {
  const agent_id = c.req.param('agentId')
  const body = await c.req.json<{ recovery_code: string }>()
  if (!body.recovery_code) return c.json({ error: 'recovery_code is required', code: 'MISSING_FIELDS' }, 400)

  try {
    const identity = restoreIdentity(agent_id, body.recovery_code)
    return c.json({ identity })
  } catch (err) {
    return c.json({ error: String(err), code: 'RESTORE_FAILED' }, 400)
  }
})

// Import backup blob (bootstrap on a fresh node — no auth)
router.post('/recovery/import', async (c) => {
  const body = await c.req.json<{ blob: string; recovery_code: string }>()
  if (!body.blob || !body.recovery_code) {
    return c.json({ error: 'blob and recovery_code are required', code: 'MISSING_FIELDS' }, 400)
  }

  try {
    const identity = importEncryptedBackup(body.blob, body.recovery_code)
    return c.json({ identity })
  } catch (err) {
    return c.json({ error: String(err), code: 'RESTORE_FAILED' }, 400)
  }
})

export default router

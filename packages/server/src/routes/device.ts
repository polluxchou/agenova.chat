// ---------------------------------------------------------------------------
// Device & Pairing routes
// POST   /v1/pairing/start
// POST   /v1/pairing/approve
// DELETE /v1/devices/:deviceId
// GET    /v1/agents/:agentId/devices
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { startPairing, approvePairing, revokeDevice, listDevices } from '../modules/device/index.js'
import { authMiddleware } from '../middleware/auth.js'

const router = new Hono()

// Start pairing — no auth (called by new device before it has an identity)
router.post('/pairing/start', async (c) => {
  const body = await c.req.json<{ device_name: string; device_public_key?: string }>()

  if (!body.device_name) {
    return c.json({ error: 'device_name is required', code: 'MISSING_FIELDS' }, 400)
  }

  const result = startPairing({ device_name: body.device_name, device_public_key: body.device_public_key })
  return c.json(result, 201)
})

// Approve pairing — auth required (called by host)
router.post('/pairing/approve', authMiddleware, async (c) => {
  const body = await c.req.json<{ pairing_code: string }>()
  const agent_id = c.get('agent_id') as string

  if (!body.pairing_code) {
    return c.json({ error: 'pairing_code is required', code: 'MISSING_FIELDS' }, 400)
  }

  try {
    const device = approvePairing({ pairing_code: body.pairing_code, agent_id })
    return c.json({ device }, 201)
  } catch (err) {
    return c.json({ error: String(err), code: 'PAIRING_FAILED' }, 400)
  }
})

// Revoke device
router.delete('/devices/:deviceId', authMiddleware, (c) => {
  revokeDevice(c.req.param('deviceId'))
  return c.json({ ok: true })
})

// List devices for an agent
router.get('/agents/:agentId/devices', authMiddleware, (c) => {
  const requesterId = c.get('agent_id') as string
  const agentId = c.req.param('agentId')

  if (requesterId !== agentId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
  }

  const devices = listDevices(agentId)
  return c.json({ devices })
})

export default router

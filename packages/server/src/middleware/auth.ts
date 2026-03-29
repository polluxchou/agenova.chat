// ---------------------------------------------------------------------------
// Auth middleware — Ed25519 request signature verification
//
// Every request must include:
//   X-Agent-Id  : <agent_id>
//   X-Signature : <base64 Ed25519 signature>
//   X-Timestamp : <ISO 8601 timestamp>
//
// Signed payload:
//   METHOD\nPATH\nX-Timestamp\nSHA-256(body) or ""
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import { createHash } from 'node:crypto'
import { getAgentById } from '../modules/identity/index.js'
import { verifySignature } from '../crypto.js'

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000   // 5 minutes replay window

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const agentId = c.req.header('x-agent-id')
  const signature = c.req.header('x-signature')
  const timestamp = c.req.header('x-timestamp')

  if (!agentId || !signature || !timestamp) {
    return c.json({ error: 'Missing auth headers (X-Agent-Id, X-Signature, X-Timestamp)', code: 'UNAUTHORIZED' }, 401)
  }

  // Replay protection
  const ts = new Date(timestamp).getTime()
  if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
    return c.json({ error: 'Request timestamp out of allowed window', code: 'UNAUTHORIZED' }, 401)
  }

  // Look up agent public key
  const agent = getAgentById(agentId)
  if (!agent || agent.status !== 'active') {
    return c.json({ error: 'Unknown or inactive agent', code: 'UNAUTHORIZED' }, 401)
  }

  // Build signing payload
  const bodyBytes = await c.req.arrayBuffer()
  const bodyHash = bodyBytes.byteLength > 0
    ? createHash('sha256').update(Buffer.from(bodyBytes)).digest('hex')
    : ''

  const method = c.req.method.toUpperCase()
  const path = new URL(c.req.url).pathname
  const signingPayload = `${method}\n${path}\n${timestamp}\n${bodyHash}`

  if (!verifySignature(agent.public_key, signingPayload, signature)) {
    return c.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, 401)
  }

  // Attach auth context to the request
  c.set('agent_id', agentId)
  c.set('public_key', agent.public_key)

  await next()
}

// ---------------------------------------------------------------------------
// Bearer token authentication middleware
//
// Validates the Authorization header against the api_tokens table.
// Tokens are stored as SHA-256 hashes — the raw token is never persisted.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import { dbGet } from '../db/client.js'
import { sha256 } from '../crypto.js'

export async function bearerAuth(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' }, 401)
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return c.json({ error: 'Empty bearer token', code: 'UNAUTHORIZED' }, 401)
  }

  // In dev/test mode, accept a static token via env var
  const devToken = process.env.AGENOVA_DEV_TOKEN
  if (devToken && token === devToken) {
    await next()
    return
  }

  // Production: check against hashed tokens in DB
  const hash = sha256(token)
  const row = dbGet<{ status: string }>(
    `SELECT status FROM api_tokens WHERE token_hash = ?`,
    hash,
  )

  if (!row || row.status !== 'active') {
    return c.json({ error: 'Invalid or revoked API token', code: 'UNAUTHORIZED' }, 401)
  }

  await next()
}

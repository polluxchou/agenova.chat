// ---------------------------------------------------------------------------
// Mailbox claim routes
//
// POST /v1/mailbox/claim/init    — start a claim, return challenge
// POST /v1/mailbox/claim/verify  — verify Ed25519 signature, bind mailbox
// POST /v1/mailbox/release       — release a mailbox handle
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { dbGet, dbRun } from '../db/client.js'
import { verifySignature, randomUuid } from '../crypto.js'

const MAILBOX_DOMAIN = process.env.AGENOVA_MAILBOX_DOMAIN ?? 'agenova.chat'
const CHALLENGE_TTL_MS = 5 * 60 * 1000  // 5 minutes

const router = new Hono()

// ---------------------------------------------------------------------------
// Init — start a claim
// ---------------------------------------------------------------------------

router.post('/mailbox/claim/init', async (c) => {
  const body = await c.req.json<{
    agent_id: string
    handle: string
    public_key: string
  }>()

  if (!body.agent_id || !body.handle || !body.public_key) {
    return c.json({ message: 'agent_id, handle, and public_key are required', code: 'MISSING_FIELDS' }, 400)
  }

  // Validate handle format (alphanumeric, hyphens, dots, 3-32 chars)
  if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/i.test(body.handle)) {
    return c.json({ message: 'Invalid handle format', code: 'VALIDATION_ERROR' }, 400)
  }

  const hosted_mailbox = `${body.handle}@${MAILBOX_DOMAIN}`

  // Check if handle is already taken
  const existing = dbGet<{ status: string }>(
    `SELECT status FROM mailbox_claims WHERE hosted_mailbox = ?`,
    hosted_mailbox,
  )

  if (existing && existing.status === 'active') {
    return c.json({ message: 'Handle already taken', code: 'DUPLICATE' }, 409)
  }

  // Check for an active pending challenge for this handle (prevent spam)
  const pendingChallenge = dbGet<{ claim_id: string; expires_at: string }>(
    `SELECT claim_id, expires_at FROM claim_challenges
     WHERE handle = ? AND status = 'pending' AND expires_at > ?`,
    body.handle,
    new Date().toISOString(),
  )

  // Create challenge
  const claim_id = randomUuid()
  const challenge = `hosted-challenge:${claim_id}:${Date.now()}`
  const now = new Date().toISOString()
  const expires_at = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()

  dbRun(
    `INSERT INTO claim_challenges (claim_id, handle, agent_id, public_key, challenge, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    claim_id,
    body.handle,
    body.agent_id,
    body.public_key,
    challenge,
    expires_at,
    now,
  )

  return c.json({ claim_id, challenge })
})

// ---------------------------------------------------------------------------
// Verify — verify signature and bind mailbox
// ---------------------------------------------------------------------------

router.post('/mailbox/claim/verify', async (c) => {
  const body = await c.req.json<{
    claim_id: string
    signature: string
  }>()

  if (!body.claim_id || !body.signature) {
    return c.json({ message: 'claim_id and signature are required', code: 'MISSING_FIELDS' }, 400)
  }

  // Fetch challenge
  const challenge = dbGet<{
    claim_id: string
    handle: string
    agent_id: string
    public_key: string
    challenge: string
    status: string
    expires_at: string
  }>(
    `SELECT * FROM claim_challenges WHERE claim_id = ?`,
    body.claim_id,
  )

  if (!challenge) {
    return c.json({ message: 'Unknown claim_id', code: 'NOT_FOUND' }, 400)
  }

  if (challenge.status !== 'pending') {
    return c.json({ message: 'Challenge already used or expired', code: 'VALIDATION_ERROR' }, 400)
  }

  if (new Date(challenge.expires_at) < new Date()) {
    dbRun(`UPDATE claim_challenges SET status = 'expired' WHERE claim_id = ?`, body.claim_id)
    return c.json({ message: 'Challenge expired', code: 'VALIDATION_ERROR' }, 400)
  }

  // Verify Ed25519 signature
  const valid = verifySignature(challenge.public_key, challenge.challenge, body.signature)
  if (!valid) {
    return c.json({ message: 'Invalid signature', code: 'FORBIDDEN' }, 403)
  }

  // Bind the mailbox
  const hosted_mailbox = `${challenge.handle}@${MAILBOX_DOMAIN}`
  const now = new Date().toISOString()

  // Double-check uniqueness (race condition guard)
  const existing = dbGet<{ status: string }>(
    `SELECT status FROM mailbox_claims WHERE hosted_mailbox = ? AND status = 'active'`,
    hosted_mailbox,
  )

  if (existing) {
    dbRun(`UPDATE claim_challenges SET status = 'expired' WHERE claim_id = ?`, body.claim_id)
    return c.json({ message: 'Handle already taken', code: 'DUPLICATE' }, 409)
  }

  // Upsert the claim (handle may exist in 'released' state)
  dbRun(
    `INSERT INTO mailbox_claims (handle, hosted_mailbox, agent_id, public_key, status, claimed_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(handle) DO UPDATE SET
       agent_id = excluded.agent_id,
       public_key = excluded.public_key,
       status = 'active',
       claimed_at = excluded.claimed_at,
       updated_at = excluded.updated_at`,
    challenge.handle,
    hosted_mailbox,
    challenge.agent_id,
    challenge.public_key,
    now,
    now,
  )

  // Mark challenge as verified
  dbRun(`UPDATE claim_challenges SET status = 'verified' WHERE claim_id = ?`, body.claim_id)

  return c.json({ hosted_mailbox })
})

// ---------------------------------------------------------------------------
// Release — give up a mailbox handle
// ---------------------------------------------------------------------------

router.post('/mailbox/release', async (c) => {
  const body = await c.req.json<{
    agent_id: string
    hosted_mailbox: string
    challenge: string
    signature: string
  }>()

  if (!body.agent_id || !body.hosted_mailbox) {
    return c.json({ message: 'agent_id and hosted_mailbox are required', code: 'MISSING_FIELDS' }, 400)
  }

  // Look up the claim
  const claim = dbGet<{
    handle: string
    agent_id: string
    public_key: string
    status: string
  }>(
    `SELECT * FROM mailbox_claims WHERE hosted_mailbox = ?`,
    body.hosted_mailbox,
  )

  if (!claim || claim.status !== 'active') {
    return c.json({ message: 'Mailbox not found or already released', code: 'NOT_FOUND' }, 404)
  }

  if (claim.agent_id !== body.agent_id) {
    return c.json({ message: 'Agent does not own this mailbox', code: 'FORBIDDEN' }, 403)
  }

  // Verify ownership via signature (if provided)
  if (body.challenge && body.signature) {
    const valid = verifySignature(claim.public_key, body.challenge, body.signature)
    if (!valid) {
      return c.json({ message: 'Invalid signature', code: 'FORBIDDEN' }, 403)
    }
  }

  // Release
  const now = new Date().toISOString()
  dbRun(
    `UPDATE mailbox_claims SET status = 'released', updated_at = ? WHERE hosted_mailbox = ?`,
    now,
    body.hosted_mailbox,
  )

  return c.json({ ok: true })
})

export default router

// ---------------------------------------------------------------------------
// Hosted API — Claim route tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, req, TEST_TOKEN, insertClaim } from './helpers.js'
import { createApp } from '../src/app.js'
import { dbGet } from '../src/db/client.js'
import { createHash, generateKeyPairSync, sign as cryptoSign, createPrivateKey } from 'node:crypto'

const app = createApp()

// Generate an Ed25519 keypair for tests
function generateTestKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' })
  const privJwk = privateKey.export({ format: 'jwk' })
  const publicKeyRaw = pubJwk.x as string
  const publicKeyField = `ed25519:${publicKeyRaw}`
  const privateKeySeed = privJwk.d as string
  return { publicKeyField, publicKeyRaw, privateKeySeed }
}

function signChallenge(challenge: string, privateKeySeed: string, publicKeyRaw: string): string {
  const privKeyObj = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: privateKeySeed, x: publicKeyRaw },
    format: 'jwk',
  })
  return Buffer.from(
    cryptoSign(null, Buffer.from(challenge, 'utf-8'), privKeyObj),
  ).toString('base64')
}

describe('Hosted API — Claim routes', () => {
  beforeEach(() => setupTest())
  afterEach(() => teardownTest())

  it('POST /v1/mailbox/claim/init returns claim_id and challenge', async () => {
    const keys = generateTestKeypair()
    const res = await req(app, 'POST', '/v1/mailbox/claim/init', {
      body: { agent_id: 'agent-1', handle: 'alice', public_key: keys.publicKeyField },
    })

    expect(res.status).toBe(200)
    expect((res.body as any).claim_id).toBeString()
    expect((res.body as any).challenge).toBeString()
    expect((res.body as any).challenge).toContain('hosted-challenge:')
  })

  it('init rejects missing fields', async () => {
    const res = await req(app, 'POST', '/v1/mailbox/claim/init', {
      body: { agent_id: 'agent-1' },
    })

    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('MISSING_FIELDS')
  })

  it('init rejects invalid handle format', async () => {
    const keys = generateTestKeypair()
    const res = await req(app, 'POST', '/v1/mailbox/claim/init', {
      body: { agent_id: 'agent-1', handle: 'a', public_key: keys.publicKeyField },
    })

    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('VALIDATION_ERROR')
  })

  it('init returns 409 for already-taken handle', async () => {
    const keys = generateTestKeypair()
    insertClaim({
      handle: 'taken',
      hosted_mailbox: 'taken@agenova.chat',
      agent_id: 'other-agent',
      public_key: keys.publicKeyField,
    })

    const res = await req(app, 'POST', '/v1/mailbox/claim/init', {
      body: { agent_id: 'agent-1', handle: 'taken', public_key: keys.publicKeyField },
    })

    expect(res.status).toBe(409)
    expect((res.body as any).code).toBe('DUPLICATE')
  })

  it('full claim flow: init → verify → mailbox bound', async () => {
    const keys = generateTestKeypair()

    // Init
    const initRes = await req<{ claim_id: string; challenge: string }>(
      app, 'POST', '/v1/mailbox/claim/init', {
        body: { agent_id: 'agent-1', handle: 'alice', public_key: keys.publicKeyField },
      },
    )
    expect(initRes.status).toBe(200)
    const { claim_id, challenge } = initRes.body

    // Sign the challenge
    const signature = signChallenge(challenge, keys.privateKeySeed, keys.publicKeyRaw)

    // Verify
    const verifyRes = await req<{ hosted_mailbox: string }>(
      app, 'POST', '/v1/mailbox/claim/verify', {
        body: { claim_id, signature },
      },
    )

    expect(verifyRes.status).toBe(200)
    expect(verifyRes.body.hosted_mailbox).toBe('alice@agenova.chat')

    // Check DB
    const claim = dbGet<{ status: string }>(`SELECT status FROM mailbox_claims WHERE handle = 'alice'`)
    expect(claim?.status).toBe('active')
  })

  it('verify rejects wrong signature', async () => {
    const keys = generateTestKeypair()
    const wrongKeys = generateTestKeypair()

    const initRes = await req<{ claim_id: string; challenge: string }>(
      app, 'POST', '/v1/mailbox/claim/init', {
        body: { agent_id: 'agent-1', handle: 'bob', public_key: keys.publicKeyField },
      },
    )
    const { claim_id, challenge } = initRes.body

    // Sign with WRONG key
    const signature = signChallenge(challenge, wrongKeys.privateKeySeed, wrongKeys.publicKeyRaw)

    const verifyRes = await req(app, 'POST', '/v1/mailbox/claim/verify', {
      body: { claim_id, signature },
    })

    expect(verifyRes.status).toBe(403)
    expect((verifyRes.body as any).code).toBe('FORBIDDEN')
  })

  it('verify rejects unknown claim_id', async () => {
    const res = await req(app, 'POST', '/v1/mailbox/claim/verify', {
      body: { claim_id: 'nonexistent', signature: 'abc' },
    })

    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('NOT_FOUND')
  })

  it('verify rejects already-used challenge', async () => {
    const keys = generateTestKeypair()

    const initRes = await req<{ claim_id: string; challenge: string }>(
      app, 'POST', '/v1/mailbox/claim/init', {
        body: { agent_id: 'agent-1', handle: 'charlie', public_key: keys.publicKeyField },
      },
    )
    const { claim_id, challenge } = initRes.body
    const signature = signChallenge(challenge, keys.privateKeySeed, keys.publicKeyRaw)

    // First verify — success
    await req(app, 'POST', '/v1/mailbox/claim/verify', {
      body: { claim_id, signature },
    })

    // Second verify — should fail
    const res = await req(app, 'POST', '/v1/mailbox/claim/verify', {
      body: { claim_id, signature },
    })

    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('VALIDATION_ERROR')
  })

  it('POST /v1/mailbox/release releases an active claim', async () => {
    const keys = generateTestKeypair()
    insertClaim({
      handle: 'release-me',
      hosted_mailbox: 'release-me@agenova.chat',
      agent_id: 'agent-1',
      public_key: keys.publicKeyField,
    })

    const res = await req(app, 'POST', '/v1/mailbox/release', {
      body: {
        agent_id: 'agent-1',
        hosted_mailbox: 'release-me@agenova.chat',
      },
    })

    expect(res.status).toBe(200)
    expect((res.body as any).ok).toBe(true)

    // Verify DB
    const claim = dbGet<{ status: string }>(`SELECT status FROM mailbox_claims WHERE handle = 'release-me'`)
    expect(claim?.status).toBe('released')
  })

  it('release rejects wrong agent', async () => {
    const keys = generateTestKeypair()
    insertClaim({
      handle: 'owned',
      hosted_mailbox: 'owned@agenova.chat',
      agent_id: 'agent-1',
      public_key: keys.publicKeyField,
    })

    const res = await req(app, 'POST', '/v1/mailbox/release', {
      body: {
        agent_id: 'wrong-agent',
        hosted_mailbox: 'owned@agenova.chat',
      },
    })

    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe('FORBIDDEN')
  })

  it('re-claim after release succeeds', async () => {
    const keys = generateTestKeypair()
    insertClaim({
      handle: 'recycled',
      hosted_mailbox: 'recycled@agenova.chat',
      agent_id: 'old-agent',
      public_key: keys.publicKeyField,
    })

    // Release
    await req(app, 'POST', '/v1/mailbox/release', {
      body: { agent_id: 'old-agent', hosted_mailbox: 'recycled@agenova.chat' },
    })

    // New agent can now claim
    const newKeys = generateTestKeypair()
    const initRes = await req<{ claim_id: string; challenge: string }>(
      app, 'POST', '/v1/mailbox/claim/init', {
        body: { agent_id: 'new-agent', handle: 'recycled', public_key: newKeys.publicKeyField },
      },
    )
    expect(initRes.status).toBe(200)

    const signature = signChallenge(initRes.body.challenge, newKeys.privateKeySeed, newKeys.publicKeyRaw)
    const verifyRes = await req(app, 'POST', '/v1/mailbox/claim/verify', {
      body: { claim_id: initRes.body.claim_id, signature },
    })

    expect(verifyRes.status).toBe(200)
    expect((verifyRes.body as any).hosted_mailbox).toBe('recycled@agenova.chat')
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — Hosted mailbox claim flow (mocked fetch)
//
// Tests the full init → verify → bind flow against a simulated hosted API.
// No network calls — _setFetch() injects a mock responder.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent } from './helpers.js'
import { _setFetch } from '../src/hosted/client.js'
import { claimMailbox, releaseMailbox, getAgentByHostedMailbox } from '../src/modules/mailbox-claim/index.js'
import { getAgentById } from '../src/modules/identity/index.js'
import { verifySignature, randomUuid } from '../src/crypto.js'

// ---------------------------------------------------------------------------
// Mock hosted service
// ---------------------------------------------------------------------------

function createMockHostedService() {
  const claims = new Map<string, { challenge: string; handle: string; public_key: string }>()
  const taken = new Set<string>()
  const calls: { url: string; method: string; body: unknown }[] = []

  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url, method: init?.method ?? 'GET', body })

    // POST /v1/mailbox/claim/init
    if (url.endsWith('/v1/mailbox/claim/init') && init?.method === 'POST') {
      const { handle, public_key, agent_id } = body
      const mailbox = `${handle}@agenova.chat`

      if (taken.has(mailbox)) {
        return new Response(JSON.stringify({ message: 'Handle already taken' }), { status: 409 })
      }

      const claim_id = randomUuid()
      const challenge = `hosted-challenge:${claim_id}:${Date.now()}`
      claims.set(claim_id, { challenge, handle, public_key })

      return new Response(JSON.stringify({ claim_id, challenge }), { status: 200 })
    }

    // POST /v1/mailbox/claim/verify
    if (url.endsWith('/v1/mailbox/claim/verify') && init?.method === 'POST') {
      const { claim_id, signature } = body
      const claim = claims.get(claim_id)
      if (!claim) {
        return new Response(JSON.stringify({ message: 'Unknown claim_id' }), { status: 400 })
      }

      // Verify signature against the public key from init
      const valid = verifySignature(claim.public_key, claim.challenge, signature)
      if (!valid) {
        return new Response(JSON.stringify({ message: 'Invalid signature' }), { status: 403 })
      }

      const hosted_mailbox = `${claim.handle}@agenova.chat`
      taken.add(hosted_mailbox)
      claims.delete(claim_id)

      return new Response(JSON.stringify({ hosted_mailbox }), { status: 200 })
    }

    // POST /v1/mailbox/release
    if (url.endsWith('/v1/mailbox/release') && init?.method === 'POST') {
      const { hosted_mailbox } = body
      taken.delete(hosted_mailbox)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    return new Response('Not Found', { status: 404 })
  }

  return { mockFetch, calls, taken }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 3 — Hosted mailbox claim (mocked)', () => {
  let mock: ReturnType<typeof createMockHostedService>

  beforeEach(() => {
    setupTest()
    mock = createMockHostedService()
    _setFetch(mock.mockFetch as typeof globalThis.fetch)
  })

  afterEach(() => {
    _setFetch(undefined)
    teardownTest()
  })

  it('full hosted claim flow: init → verify → bind', async () => {
    const agent = createTestAgent('hosted@local')

    const result = await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'hosted-user',
      private_key_seed: agent.private_key,
      public_key_raw: agent.public_key_raw,
    })

    expect(result.hosted_mailbox).toBe('hosted-user@agenova.chat')
    expect(result.claim_id).toBeString()

    // Verify local binding
    const loaded = getAgentById(agent.agent_id)!
    expect(loaded.hosted_mailbox).toBe('hosted-user@agenova.chat')

    // Verify reverse lookup
    const byMailbox = getAgentByHostedMailbox('hosted-user@agenova.chat')!
    expect(byMailbox.agent_id).toBe(agent.agent_id)

    // Verify the mock saw both calls
    expect(mock.calls.length).toBe(2)
    expect(mock.calls[0].url).toContain('/v1/mailbox/claim/init')
    expect(mock.calls[1].url).toContain('/v1/mailbox/claim/verify')
  })

  it('sends correct fields to init endpoint', async () => {
    const agent = createTestAgent('fields@local')

    await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'field-test',
      private_key_seed: agent.private_key,
      public_key_raw: agent.public_key_raw,
    })

    const initCall = mock.calls[0]
    expect(initCall.body).toEqual({
      agent_id: agent.agent_id,
      handle: 'field-test',
      public_key: agent.public_key,
    })
  })

  it('signs the challenge returned by init', async () => {
    const agent = createTestAgent('sig@local')

    await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'sig-test',
      private_key_seed: agent.private_key,
      public_key_raw: agent.public_key_raw,
    })

    // The mock hosted service internally verified the signature
    // If it was wrong, it would have returned 403
    const verifyCall = mock.calls[1]
    expect(verifyCall.body).toHaveProperty('claim_id')
    expect(verifyCall.body).toHaveProperty('signature')
  })

  it('rejects duplicate handle on hosted side (409)', async () => {
    const a1 = createTestAgent('dup1@local')
    const a2 = createTestAgent('dup2@local')

    await claimMailbox({
      agent_id: a1.agent_id,
      handle: 'taken-name',
      private_key_seed: a1.private_key,
      public_key_raw: a1.public_key_raw,
    })

    await expect(
      claimMailbox({
        agent_id: a2.agent_id,
        handle: 'taken-name',
        private_key_seed: a2.private_key,
        public_key_raw: a2.public_key_raw,
      }),
    ).rejects.toThrow(/rejected/)
  })

  it('rejects when agent already has a mailbox', async () => {
    const agent = createTestAgent('double@local')

    await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'first-claim',
      private_key_seed: agent.private_key,
      public_key_raw: agent.public_key_raw,
    })

    await expect(
      claimMailbox({
        agent_id: agent.agent_id,
        handle: 'second-claim',
        private_key_seed: agent.private_key,
        public_key_raw: agent.public_key_raw,
      }),
    ).rejects.toThrow(/already has a hosted mailbox/)
  })

  it('rejects with wrong private key (signature mismatch on hosted)', async () => {
    const agent = createTestAgent('wrongkey@local')
    const other = createTestAgent('other@local')

    await expect(
      claimMailbox({
        agent_id: agent.agent_id,
        handle: 'wrongkey-test',
        private_key_seed: other.private_key,          // wrong key
        public_key_raw: other.public_key_raw,          // wrong key
      }),
    ).rejects.toThrow(/verification failed/)
  })

  it('releaseMailbox() resets mailbox_status to unclaimed', async () => {
    const agent = createTestAgent('release@local')

    await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'to-release',
      private_key_seed: agent.private_key,
      public_key_raw: agent.public_key_raw,
    })

    // Verify claimed state
    const afterClaim = getAgentById(agent.agent_id)!
    expect(afterClaim.hosted_mailbox).toBe('to-release@agenova.chat')
    expect(afterClaim.mailbox_status).toBe('claimed')

    await releaseMailbox(agent.agent_id, agent.private_key, agent.public_key_raw)

    // After release: mailbox NULL, status back to unclaimed
    const afterRelease = getAgentById(agent.agent_id)!
    expect(afterRelease.hosted_mailbox).toBeNull()
    expect(afterRelease.mailbox_status).toBe('unclaimed')
    expect(afterRelease.claimed_at).toBeString() // preserved (historical record)
  })

  it('releaseMailbox() throws when agent has no mailbox', async () => {
    const agent = createTestAgent('nomailbox@local')

    await expect(
      releaseMailbox(agent.agent_id, agent.private_key, agent.public_key_raw),
    ).rejects.toThrow(/No hosted mailbox/)
  })

  it('handles hosted service returning 500 with retry', async () => {
    let attempt = 0
    const flaky: typeof globalThis.fetch = async (input, init) => {
      attempt++
      if (attempt <= 1) {
        return new Response('Internal Error', { status: 500 })
      }
      // Fall through to normal mock after first failure
      return mock.mockFetch(input as any, init)
    }
    _setFetch(flaky as typeof globalThis.fetch)

    const agent = createTestAgent('retry@local')
    const result = await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'retry-test',
      private_key_seed: agent.private_key,
      public_key_raw: agent.public_key_raw,
    })

    // Succeeds after retry
    expect(result.hosted_mailbox).toBe('retry-test@agenova.chat')
    expect(attempt).toBeGreaterThan(1)
  })
})

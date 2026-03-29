// ---------------------------------------------------------------------------
// Phase 2 — End-to-end flow: Identity + Mailbox Binding
//
// This tests the complete user journey from the PRD:
//   1. Start Agenova locally                          ✓ (app factory)
//   2. Create an agent identity                       ✓
//   3. Request and bind an @agenova.chat mailbox      ✓ (local claim)
//   4. Receive mail                                   ✓
//   5. Extract verification codes automatically       ✓
//   6. Verify the same identity persists across reads ✓
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, req, buildAuthHeaders, type TestAgent } from './helpers.js'
import { createApp } from '../src/app.js'
import { createAgent, getAgentById, getAgentByEmail } from '../src/modules/identity/index.js'
import { claimMailboxLocal, bindMailbox, getAgentByHostedMailbox } from '../src/modules/mailbox-claim/index.js'
import { grantScope } from '../src/modules/policy/index.js'
import { saveEmail } from '../src/modules/inbound-mail/index.js'
import { extractCode } from '../src/modules/hosted-sync/index.js'
import { verifySignature, deriveAgentId } from '../src/crypto.js'
import { SCOPES } from '../src/types.js'
import type { InboundEmail } from '../src/types.js'

const app = createApp({ enableLogger: false })

// Helper: build a TestAgent from createAgent result
function toTestAgent(result: ReturnType<typeof createAgent>): TestAgent {
  return {
    agent_id: result.agent.agent_id,
    email_address: result.agent.email_address,
    public_key: result.agent.public_key,
    public_key_raw: result.agent.public_key.slice('ed25519:'.length),
    private_key: result.private_key,
  }
}

describe('Phase 2 — Identity + Mailbox Binding flow', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // =========================================================================
  // Full user journey — modules layer
  // =========================================================================

  describe('full user journey (module-level)', () => {
    it('Step 1–6: create → claim → receive → extract code', () => {
      // Step 1: Create an agent identity
      const result = createAgent({ email_address: 'alice@local', display_name: 'Alice' })
      const agent = result.agent
      const privateKey = result.private_key
      const publicKeyRaw = agent.public_key.slice('ed25519:'.length)

      expect(agent.agent_id).toBeString()
      expect(agent.email_address).toBe('alice@local')
      expect(agent.hosted_mailbox).toBeUndefined()   // not yet claimed

      // Step 2: Agent ID is deterministic from the public key (nit compat)
      expect(agent.agent_id).toBe(deriveAgentId(agent.public_key))

      // Step 3: Claim @agenova.chat mailbox via local claim
      const claim = claimMailboxLocal({
        agent_id: agent.agent_id,
        handle: 'alice',
        private_key_seed: privateKey,
        public_key_raw: publicKeyRaw,
      })
      expect(claim.hosted_mailbox).toBe('alice@agenova.chat')
      expect(claim.claim_id).toBeString()

      // Verify the binding persisted
      const reloaded = getAgentById(agent.agent_id)!
      expect(reloaded.hosted_mailbox).toBe('alice@agenova.chat')

      // Verify reverse lookup works
      const byMailbox = getAgentByHostedMailbox('alice@agenova.chat')!
      expect(byMailbox.agent_id).toBe(agent.agent_id)

      // Step 4: Receive an inbound email (simulating hosted sync)
      const email: InboundEmail = {
        id: crypto.randomUUID(),
        mailbox: 'alice@agenova.chat',
        agent_id: agent.agent_id,
        from_address: 'noreply@github.com',
        from_name: 'GitHub',
        to_address: 'alice@agenova.chat',
        subject: 'Your verification code is 847291',
        body_text: 'Your GitHub verification code is 847291. Enter this code to continue.',
        body_html: '',
        code: extractCode('Your verification code is 847291', 'Your GitHub verification code is 847291'),
        headers: {},
        metadata: {},
        message_id: null,
        has_attachments: false,
        attachment_count: 0,
        attachment_names: '',
        attachment_search_text: '',
        direction: 'inbound',
        status: 'received',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }
      saveEmail(email)

      // Step 5: Code was extracted
      expect(email.code).toBe('847291')

      // Step 6: Identity remains consistent after all operations
      const final = getAgentById(agent.agent_id)!
      expect(final.agent_id).toBe(agent.agent_id)
      expect(final.public_key).toBe(agent.public_key)
      expect(final.hosted_mailbox).toBe('alice@agenova.chat')
      expect(final.status).toBe('active')
    })

    it('rejects duplicate handle claim', () => {
      const r1 = createAgent({ email_address: 'a1@local', display_name: 'A1' })
      const r2 = createAgent({ email_address: 'a2@local', display_name: 'A2' })

      claimMailboxLocal({
        agent_id: r1.agent.agent_id,
        handle: 'unique-name',
        private_key_seed: r1.private_key,
        public_key_raw: r1.agent.public_key.slice('ed25519:'.length),
      })

      expect(() =>
        claimMailboxLocal({
          agent_id: r2.agent.agent_id,
          handle: 'unique-name',
          private_key_seed: r2.private_key,
          public_key_raw: r2.agent.public_key.slice('ed25519:'.length),
        }),
      ).toThrow(/already taken/)
    })

    it('rejects re-claim when agent already has a mailbox', () => {
      const r = createAgent({ email_address: 'once@local', display_name: 'Once' })
      claimMailboxLocal({
        agent_id: r.agent.agent_id,
        handle: 'once',
        private_key_seed: r.private_key,
        public_key_raw: r.agent.public_key.slice('ed25519:'.length),
      })

      expect(() =>
        claimMailboxLocal({
          agent_id: r.agent.agent_id,
          handle: 'once-again',
          private_key_seed: r.private_key,
          public_key_raw: r.agent.public_key.slice('ed25519:'.length),
        }),
      ).toThrow(/already has a hosted mailbox/)
    })

    it('verifies key ownership during claim (wrong key fails)', () => {
      const r1 = createAgent({ email_address: 'real@local', display_name: 'Real' })
      const r2 = createAgent({ email_address: 'imposter@local', display_name: 'Imposter' })

      // Try to claim using r1's agent_id but r2's keys
      expect(() =>
        claimMailboxLocal({
          agent_id: r1.agent.agent_id,
          handle: 'stolen',
          private_key_seed: r2.private_key,
          public_key_raw: r2.agent.public_key.slice('ed25519:'.length),
        }),
      ).toThrow(/Key ownership verification failed/)
    })
  })

  // =========================================================================
  // Full user journey — HTTP routes layer
  // =========================================================================

  describe('full user journey (HTTP routes)', () => {
    it('POST create → POST claim → GET inbox → GET code', async () => {
      // 1. Create agent via HTTP
      const createRes = await app.request('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email_address: 'bob@local', display_name: 'Bob' }),
      })
      expect(createRes.status).toBe(201)
      const { agent: agentData, private_key } = await createRes.json() as {
        agent: { agent_id: string; public_key: string; email_address: string }
        private_key: string
      }

      const agent: TestAgent = {
        agent_id: agentData.agent_id,
        email_address: agentData.email_address,
        public_key: agentData.public_key,
        public_key_raw: agentData.public_key.slice('ed25519:'.length),
        private_key,
      }

      // 2. Grant scopes (in real app this would be part of setup)
      for (const scope of Object.values(SCOPES)) {
        grantScope({ agent_id: agent.agent_id, scope, granted_by: agent.agent_id })
      }

      // 3. Claim mailbox via HTTP (local claim mode since AGENOVA_HOSTED_URL is not set)
      const { status: claimStatus, body: claimBody } = await req<{ hosted_mailbox: string }>(
        app, 'POST', `/v1/agents/${agent.agent_id}/mailbox/claim`,
        {
          agent,
          body: {
            handle: 'bob',
            private_key_seed: agent.private_key,
            public_key_raw: agent.public_key_raw,
          },
        },
      )
      expect(claimStatus).toBe(201)
      expect(claimBody.hosted_mailbox).toBe('bob@agenova.chat')

      // 4. Seed inbound email with a verification code
      saveEmail({
        id: crypto.randomUUID(),
        mailbox: 'bob@agenova.chat',
        agent_id: agent.agent_id,
        from_address: 'auth@stripe.com',
        from_name: 'Stripe',
        to_address: 'bob@agenova.chat',
        subject: 'Verify your email',
        body_text: 'Your verification code is 991234',
        body_html: '',
        code: '991234',
        headers: {},
        metadata: {},
        message_id: null,
        has_attachments: false,
        attachment_count: 0,
        attachment_names: '',
        attachment_search_text: '',
        direction: 'inbound',
        status: 'received',
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })

      // 5. Read inbox via HTTP
      const { status: inboxStatus, body: inboxBody } = await req<{ emails: { subject: string }[] }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/inbox`, { agent },
      )
      expect(inboxStatus).toBe(200)
      expect(inboxBody.emails.length).toBe(1)
      expect(inboxBody.emails[0].subject).toBe('Verify your email')

      // 6. Extract verification code via HTTP
      const { status: codeStatus, body: codeBody } = await req<{ code: string; from: string; subject: string }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/inbox/code`, { agent },
      )
      expect(codeStatus).toBe(200)
      expect(codeBody.code).toBe('991234')
      expect(codeBody.from).toBe('auth@stripe.com')
    })
  })

  // =========================================================================
  // Signature verification — cross-check
  // =========================================================================

  describe('signature cross-verification', () => {
    it('a message signed by agent A can be verified using A\'s stored public key', () => {
      const r = createAgent({ email_address: 'signer@local', display_name: 'Signer' })
      const { signMessage } = require('../src/crypto.js')
      const msg = 'verify me'
      const sig = signMessage(msg, r.private_key, r.agent.public_key.slice('ed25519:'.length))

      // Verify using the public key stored in the DB
      const stored = getAgentById(r.agent.agent_id)!
      expect(verifySignature(stored.public_key, msg, sig)).toBe(true)
    })

    it('a message signed by agent A fails verification against agent B\'s key', () => {
      const rA = createAgent({ email_address: 'sigA@local', display_name: 'A' })
      const rB = createAgent({ email_address: 'sigB@local', display_name: 'B' })
      const { signMessage } = require('../src/crypto.js')
      const sig = signMessage('test', rA.private_key, rA.agent.public_key.slice('ed25519:'.length))

      expect(verifySignature(rB.agent.public_key, 'test', sig)).toBe(false)
    })
  })
})

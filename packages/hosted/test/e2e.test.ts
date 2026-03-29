// ---------------------------------------------------------------------------
// Phase 6 — End-to-end integration test
//
// Runs the LOCAL server's claim/sync code against the REAL hosted server app.
// No network calls — uses the local server's _setFetch() to route requests
// directly to the hosted Hono app's .request() method.
//
// This proves that:
//   1. claimMailbox() init → verify → bind works against real hosted logic
//   2. syncMailbox() fetches real emails stored in the hosted DB
//   3. sendMailHosted() queues real outbound via the hosted send endpoint
//   4. webhook → inbox → sync → local DB is a complete pipeline
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

// Hosted server imports
import { createApp as createHostedApp } from '../src/app.js'
import { _createTestDb as createHostedTestDb, _resetDb as resetHostedDb, dbRun as hostedDbRun } from '../src/db/client.js'

// Local server imports — reach into the sibling package
import { _createTestDb as createLocalTestDb, _resetDb as resetLocalDb } from '../../server/src/db/client.js'
import { _resetMasterKey } from '../../server/src/crypto.js'
import { _setFetch } from '../../server/src/hosted/client.js'
import { createAgent } from '../../server/src/modules/identity/index.js'
import { claimMailbox } from '../../server/src/modules/mailbox-claim/index.js'
import { syncMailbox, sendMailHosted, _resetSyncLoop } from '../../server/src/modules/hosted-sync/index.js'
import { getAgentById } from '../../server/src/modules/identity/index.js'
import { getEmails, getLatestCode } from '../../server/src/modules/inbound-mail/index.js'

const TEST_MASTER_KEY = Buffer.alloc(32, 0xab)

describe('Phase 6 — E2E: Local server ↔ Hosted server', () => {
  let hostedApp: ReturnType<typeof createHostedApp>

  beforeEach(() => {
    // Set up BOTH databases
    _resetMasterKey(TEST_MASTER_KEY)
    createLocalTestDb()
    createHostedTestDb()

    hostedApp = createHostedApp()

    // Set dev token for hosted auth
    process.env.AGENOVA_DEV_TOKEN = 'e2e-test-token'
    process.env.AGENOVA_API_TOKEN = 'e2e-test-token'
    process.env.AGENOVA_HOSTED_URL = 'http://localhost:3100'  // doesn't matter — fetch is intercepted

    // Bridge: route local server's hosted fetch through the Hono app directly
    _setFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      const parsed = new URL(url)
      const path = parsed.pathname + parsed.search

      const res = await hostedApp.request(path, {
        method: init?.method ?? 'GET',
        headers: init?.headers as Record<string, string>,
        body: init?.body as string | undefined,
      })

      // Return a standard Response (Hono test responses are already standard)
      return res
    })
  })

  afterEach(() => {
    _setFetch(undefined)
    _resetSyncLoop()
    resetLocalDb()
    resetHostedDb()
    _resetMasterKey()
    delete process.env.AGENOVA_DEV_TOKEN
    delete process.env.AGENOVA_API_TOKEN
    delete process.env.AGENOVA_HOSTED_URL
  })

  // -----------------------------------------------------------------------
  // Claim flow
  // -----------------------------------------------------------------------

  it('claimMailbox() works against real hosted server (init → verify → bind)', async () => {
    // Create a local agent
    const { agent, private_key } = createAgent({ email_address: 'alice@local', display_name: 'Alice' })
    const public_key_raw = agent.public_key.slice('ed25519:'.length)

    // Claim via the real hosted server
    const result = await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'alice',
      private_key_seed: private_key,
      public_key_raw,
    })

    expect(result.hosted_mailbox).toBe('alice@agenova.chat')
    expect(result.claim_id).toBeString()

    // Verify local DB updated
    const loaded = getAgentById(agent.agent_id)
    expect(loaded?.hosted_mailbox).toBe('alice@agenova.chat')
    expect(loaded?.mailbox_status).toBe('claimed')
    expect(loaded?.claimed_at).toBeString()
  })

  it('duplicate handle rejected by real hosted server', async () => {
    const a1 = createAgent({ email_address: 'a1@local', display_name: 'A1' })
    const a2 = createAgent({ email_address: 'a2@local', display_name: 'A2' })

    await claimMailbox({
      agent_id: a1.agent.agent_id,
      handle: 'unique-name',
      private_key_seed: a1.private_key,
      public_key_raw: a1.agent.public_key.slice('ed25519:'.length),
    })

    await expect(
      claimMailbox({
        agent_id: a2.agent.agent_id,
        handle: 'unique-name',
        private_key_seed: a2.private_key,
        public_key_raw: a2.agent.public_key.slice('ed25519:'.length),
      }),
    ).rejects.toThrow(/rejected/)
  })

  // -----------------------------------------------------------------------
  // Webhook → Inbox → Sync pipeline
  // -----------------------------------------------------------------------

  it('webhook → hosted inbox → syncMailbox → local DB (full pipeline)', async () => {
    // 1. Create agent and claim mailbox
    const { agent, private_key } = createAgent({ email_address: 'bob@local', display_name: 'Bob' })
    const public_key_raw = agent.public_key.slice('ed25519:'.length)

    await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'bob',
      private_key_seed: private_key,
      public_key_raw,
    })

    // 2. Simulate inbound email via webhook (directly to hosted DB)
    const webhookRes = await hostedApp.request('/v1/webhook/inbound', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from_address: 'service@example.com',
        to_address: 'bob@agenova.chat',
        subject: 'Your verification code is 847291',
        body_text: 'Enter code 847291 to verify your account.',
      }),
    })
    expect(webhookRes.status).toBe(201)

    // 3. Sync from hosted → local
    const count = await syncMailbox('bob@agenova.chat', 'e2e-test-token')
    expect(count).toBe(1)

    // 4. Verify email in local DB
    const emails = getEmails('bob@agenova.chat')
    expect(emails.length).toBe(1)
    expect(emails[0].subject).toBe('Your verification code is 847291')
    expect(emails[0].agent_id).toBe(agent.agent_id)

    // 5. Verify code extraction
    const code = getLatestCode('bob@agenova.chat')
    expect(code).not.toBeNull()
    expect(code!.code).toBe('847291')
  })

  it('incremental sync uses since= and sync_cursor is persisted', async () => {
    const { agent, private_key } = createAgent({ email_address: 'incr@local', display_name: 'Incr' })
    const public_key_raw = agent.public_key.slice('ed25519:'.length)

    await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'incremental',
      private_key_seed: private_key,
      public_key_raw,
    })

    // First email
    hostedDbRun(
      `INSERT INTO emails (id, mailbox, from_address, from_name, to_address, subject, body_text, body_html,
                           received_at, created_at)
       VALUES ('e1', 'incremental@agenova.chat', 'a@b.com', '', 'incremental@agenova.chat',
               'First', 'body1', '', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    )

    await syncMailbox('incremental@agenova.chat', 'e2e-test-token')
    expect(getEmails('incremental@agenova.chat').length).toBe(1)

    // Verify sync_cursor was stored
    const loaded1 = getAgentById(agent.agent_id)
    expect(loaded1?.sync_cursor).toBe('2024-01-01T00:00:00Z')

    // Second email (newer)
    hostedDbRun(
      `INSERT INTO emails (id, mailbox, from_address, from_name, to_address, subject, body_text, body_html,
                           received_at, created_at)
       VALUES ('e2', 'incremental@agenova.chat', 'a@b.com', '', 'incremental@agenova.chat',
               'Second', 'body2', '', '2024-06-01T00:00:00Z', '2024-06-01T00:00:00Z')`,
    )

    const count2 = await syncMailbox('incremental@agenova.chat', 'e2e-test-token')
    expect(count2).toBe(1) // only the new one

    // Total in local DB
    expect(getEmails('incremental@agenova.chat').length).toBe(2)

    // Cursor updated
    const loaded2 = getAgentById(agent.agent_id)
    expect(loaded2?.sync_cursor).toBe('2024-06-01T00:00:00Z')
  })

  // -----------------------------------------------------------------------
  // Outbound send
  // -----------------------------------------------------------------------

  it('sendMailHosted() queues email via real hosted send endpoint', async () => {
    const result = await sendMailHosted({
      from: 'alice@agenova.chat',
      to: 'external@example.com',
      subject: 'Sent via E2E',
      text: 'Hello from local server through hosted',
    })

    expect(result.id).toBeString()
  })

  // -----------------------------------------------------------------------
  // Release flow
  // -----------------------------------------------------------------------

  it('releaseMailbox() releases on hosted and clears local binding', async () => {
    const { agent, private_key } = createAgent({ email_address: 'temp@local', display_name: 'Temp' })
    const public_key_raw = agent.public_key.slice('ed25519:'.length)

    await claimMailbox({
      agent_id: agent.agent_id,
      handle: 'temporary',
      private_key_seed: private_key,
      public_key_raw,
    })

    // Import releaseMailbox
    const { releaseMailbox } = await import('../../server/src/modules/mailbox-claim/index.js')

    await releaseMailbox(agent.agent_id, private_key, public_key_raw)

    // Local agent should have no mailbox
    const loaded = getAgentById(agent.agent_id)
    expect(loaded?.hosted_mailbox).toBeNull()
  })
})

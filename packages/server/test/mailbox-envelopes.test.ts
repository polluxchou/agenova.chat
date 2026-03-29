// ---------------------------------------------------------------------------
// Phase 4 — Mailbox envelope routes tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, grantDefaultScopes, req } from './helpers.js'
import { createApp } from '../src/app.js'

describe('Phase 4 — Mailbox envelope routes', () => {
  let app: ReturnType<typeof createApp>
  let alice: ReturnType<typeof createTestAgent>
  let bob: ReturnType<typeof createTestAgent>

  beforeEach(() => {
    setupTest()
    app = createApp()
    alice = createTestAgent('alice@local', 'Alice')
    bob = createTestAgent('bob@local', 'Bob')
    grantDefaultScopes(alice.agent_id)
    grantDefaultScopes(bob.agent_id)
  })

  afterEach(() => {
    teardownTest()
  })

  // Helper: send a message from alice to bob
  async function sendAliceToBob(overrides: Record<string, unknown> = {}) {
    return req(app, 'POST', '/v1/mail/send', {
      agent: alice,
      body: {
        to_agent: bob.agent_id,
        message_type: 'task',
        subject: 'Hello Bob',
        body: 'This is a test message',
        from_private_key: alice.private_key,
        from_public_key_raw: alice.public_key_raw,
        ...overrides,
      },
    })
  }

  // -------------------------------------------------------------------------
  // POST /v1/mail/send
  // -------------------------------------------------------------------------

  it('POST send alice→bob → 201, has envelope.message_id', async () => {
    const res = await sendAliceToBob()
    expect(res.status).toBe(201)
    expect((res.body as any).envelope.message_id).toBeString()
  })

  it('POST with missing fields → 400, code === MISSING_FIELDS', async () => {
    const res = await req(app, 'POST', '/v1/mail/send', {
      agent: alice,
      body: {
        to_agent: bob.agent_id,
        // missing message_type, subject, body, from_private_key, from_public_key_raw
      },
    })
    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('MISSING_FIELDS')
  })

  it('POST with invalid to_agent → 400 (sendMail throws)', async () => {
    const res = await sendAliceToBob({ to_agent: 'nonexistent-agent-id' })
    expect(res.status).toBe(400)
  })

  // -------------------------------------------------------------------------
  // GET inbox/outbox
  // -------------------------------------------------------------------------

  it('GET bob inbox → 200, messages array contains the sent message', async () => {
    await sendAliceToBob()
    const res = await req(app, 'GET', `/v1/agents/${bob.agent_id}/mail/inbox`, { agent: bob })
    expect(res.status).toBe(200)
    const messages = (res.body as any).messages
    expect(Array.isArray(messages)).toBe(true)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0].to_agent).toBe(bob.agent_id)
  })

  it('GET alice outbox → 200, messages array contains the sent message', async () => {
    await sendAliceToBob()
    const res = await req(app, 'GET', `/v1/agents/${alice.agent_id}/mail/outbox`, { agent: alice })
    expect(res.status).toBe(200)
    const messages = (res.body as any).messages
    expect(Array.isArray(messages)).toBe(true)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0].from_agent).toBe(alice.agent_id)
  })

  // -------------------------------------------------------------------------
  // GET /v1/mail/:messageId
  // -------------------------------------------------------------------------

  it('GET single message → 200, has { envelope, verified }, verified === true', async () => {
    const sendRes = await sendAliceToBob()
    const messageId = (sendRes.body as any).envelope.message_id

    const res = await req(app, 'GET', `/v1/mail/${messageId}`, { agent: alice })
    expect(res.status).toBe(200)
    expect((res.body as any).envelope).toBeDefined()
    expect((res.body as any).verified).toBe(true)
  })

  it('GET /v1/mail/unknown-id → 404, code === NOT_FOUND', async () => {
    const res = await req(app, 'GET', '/v1/mail/unknown-id-12345', { agent: alice })
    expect(res.status).toBe(404)
    expect((res.body as any).code).toBe('NOT_FOUND')
  })

  it('GET single message by charlie (third agent) → 403, code === FORBIDDEN', async () => {
    const charlie = createTestAgent('charlie@local', 'Charlie')
    grantDefaultScopes(charlie.agent_id)

    const sendRes = await sendAliceToBob()
    const messageId = (sendRes.body as any).envelope.message_id

    const res = await req(app, 'GET', `/v1/mail/${messageId}`, { agent: charlie })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe('FORBIDDEN')
  })

  // -------------------------------------------------------------------------
  // GET /v1/mail/threads/:threadId
  // -------------------------------------------------------------------------

  it('GET thread by alice → returns messages in thread', async () => {
    const sendRes = await sendAliceToBob()
    const threadId = (sendRes.body as any).envelope.thread_id

    const res = await req(app, 'GET', `/v1/mail/threads/${threadId}`, { agent: alice })
    expect(res.status).toBe(200)
    const messages = (res.body as any).messages
    expect(Array.isArray(messages)).toBe(true)
    expect(messages.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // Forbidden access
  // -------------------------------------------------------------------------

  it('GET bob inbox by alice → 403, code === FORBIDDEN', async () => {
    const res = await req(app, 'GET', `/v1/agents/${bob.agent_id}/mail/inbox`, { agent: alice })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe('FORBIDDEN')
  })

  // -------------------------------------------------------------------------
  // Scope tests
  // -------------------------------------------------------------------------

  it('GET inbox without MAIL_READ scope → 403', async () => {
    const noScope = createTestAgent('noscopemail@local', 'No Scope Mail')
    // No grantDefaultScopes — no MAIL_READ scope
    const res = await req(app, 'GET', `/v1/agents/${noScope.agent_id}/mail/inbox`, { agent: noScope })
    expect(res.status).toBe(403)
  })

  // -------------------------------------------------------------------------
  // Thread with two messages
  // -------------------------------------------------------------------------

  it('thread with two messages: both show up in thread GET', async () => {
    // First message
    const sendRes1 = await sendAliceToBob({ subject: 'Message 1', body: 'First message' })
    const threadId = (sendRes1.body as any).envelope.thread_id

    // Reply in same thread
    await req(app, 'POST', '/v1/mail/send', {
      agent: bob,
      body: {
        to_agent: alice.agent_id,
        message_type: 'reply',
        subject: 'Message 2',
        body: 'Second message',
        thread_id: threadId,
        from_private_key: bob.private_key,
        from_public_key_raw: bob.public_key_raw,
      },
    })

    const res = await req(app, 'GET', `/v1/mail/threads/${threadId}`, { agent: alice })
    expect(res.status).toBe(200)
    const messages = (res.body as any).messages
    expect(messages.length).toBe(2)
  })
})

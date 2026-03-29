// ---------------------------------------------------------------------------
// Mailbox + Inbound-mail route integration tests
//
// Tests agent-to-agent envelope flow and inbound email operations.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, grantDefaultScopes, req } from './helpers.js'
import { createApp } from '../src/app.js'
import { saveEmail } from '../src/modules/inbound-mail/index.js'
import { bindMailbox } from '../src/modules/mailbox-claim/index.js'
import type { InboundEmail } from '../src/types.js'

const app = createApp({ enableLogger: false })

describe('mailbox routes', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // -------------------------------------------------------------------------
  // Agent-to-agent envelopes: POST /v1/mail/send
  // -------------------------------------------------------------------------

  describe('POST /v1/mail/send', () => {
    it('sends a signed envelope between two agents', async () => {
      const sender = createTestAgent('sender@local')
      const receiver = createTestAgent('receiver@local')
      grantDefaultScopes(sender.agent_id)

      const { status, body } = await req<{ envelope: { message_id: string; from_agent: string; to_agent: string } }>(
        app, 'POST', '/v1/mail/send',
        {
          agent: sender,
          body: {
            to_agent: receiver.agent_id,
            message_type: 'task',
            subject: 'Test message',
            body: 'Hello receiver',
            from_private_key: sender.private_key,
            from_public_key_raw: sender.public_key_raw,
          },
        },
      )

      expect(status).toBe(201)
      expect(body.envelope.message_id).toBeString()
      expect(body.envelope.from_agent).toBe(sender.agent_id)
      expect(body.envelope.to_agent).toBe(receiver.agent_id)
    })

    it('returns 403 without mail.write scope', async () => {
      const sender = createTestAgent('nowrite@local')
      createTestAgent('recv@local')

      const { status } = await req(app, 'POST', '/v1/mail/send', {
        agent: sender,
        body: {
          to_agent: 'recv-agent-id',
          message_type: 'note',
          subject: 'Hi',
          body: 'Nope',
          from_private_key: sender.private_key,
          from_public_key_raw: sender.public_key_raw,
        },
      })

      expect(status).toBe(403)
    })
  })

  // -------------------------------------------------------------------------
  // Inbox: GET /v1/agents/:id/mail/inbox
  // -------------------------------------------------------------------------

  describe('GET /v1/agents/:id/mail/inbox', () => {
    it('returns inbox messages for the agent', async () => {
      const sender = createTestAgent('s1@local')
      const receiver = createTestAgent('r1@local')
      grantDefaultScopes(sender.agent_id)
      grantDefaultScopes(receiver.agent_id)

      // Send a message
      await req(app, 'POST', '/v1/mail/send', {
        agent: sender,
        body: {
          to_agent: receiver.agent_id,
          message_type: 'note',
          subject: 'Inbox test',
          body: 'Checking inbox',
          from_private_key: sender.private_key,
          from_public_key_raw: sender.public_key_raw,
        },
      })

      // Read receiver's inbox
      const { status, body } = await req<{ messages: { subject: string }[] }>(
        app, 'GET', `/v1/agents/${receiver.agent_id}/mail/inbox`, { agent: receiver },
      )

      expect(status).toBe(200)
      expect(body.messages.length).toBe(1)
      expect(body.messages[0].subject).toBe('Inbox test')
    })
  })

  // -------------------------------------------------------------------------
  // Thread: GET /v1/mail/threads/:threadId
  // -------------------------------------------------------------------------

  describe('GET /v1/mail/threads/:threadId', () => {
    it('returns all messages in a thread', async () => {
      const a1 = createTestAgent('t1@local')
      const a2 = createTestAgent('t2@local')
      grantDefaultScopes(a1.agent_id)
      grantDefaultScopes(a2.agent_id)

      // a1 sends to a2
      const { body: sendBody } = await req<{ envelope: { thread_id: string } }>(
        app, 'POST', '/v1/mail/send',
        {
          agent: a1,
          body: {
            to_agent: a2.agent_id,
            message_type: 'task',
            subject: 'Thread start',
            body: 'First',
            from_private_key: a1.private_key,
            from_public_key_raw: a1.public_key_raw,
          },
        },
      )

      const threadId = sendBody.envelope.thread_id

      // a2 replies in the same thread
      await req(app, 'POST', '/v1/mail/send', {
        agent: a2,
        body: {
          to_agent: a1.agent_id,
          message_type: 'reply',
          subject: 'Re: Thread start',
          body: 'Second',
          thread_id: threadId,
          from_private_key: a2.private_key,
          from_public_key_raw: a2.public_key_raw,
        },
      })

      // a1 reads the thread
      const { status, body } = await req<{ messages: { subject: string }[] }>(
        app, 'GET', `/v1/mail/threads/${threadId}`, { agent: a1 },
      )

      expect(status).toBe(200)
      expect(body.messages.length).toBe(2)
    })
  })
})

// ---------------------------------------------------------------------------
// Inbound-mail routes (external email from @agenova.chat)
// ---------------------------------------------------------------------------

describe('inbound-mail routes', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  function seedInboundEmail(agentId: string, mailbox: string, overrides: Partial<InboundEmail> = {}): InboundEmail {
    const email: InboundEmail = {
      id: crypto.randomUUID(),
      mailbox,
      agent_id: agentId,
      from_address: 'service@example.com',
      from_name: 'Example Service',
      to_address: mailbox,
      subject: 'Your verification code',
      body_text: 'Your code is 482910',
      body_html: '',
      code: '482910',
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
      ...overrides,
    }
    saveEmail(email)
    return email
  }

  describe('GET /v1/agents/:id/inbox', () => {
    it('returns inbound emails for a bound mailbox', async () => {
      const agent = createTestAgent('inbox@local')
      grantDefaultScopes(agent.agent_id)
      bindMailbox(agent.agent_id, 'inbox@agenova.chat')

      seedInboundEmail(agent.agent_id, 'inbox@agenova.chat')
      seedInboundEmail(agent.agent_id, 'inbox@agenova.chat', {
        subject: 'Another email',
        body_text: 'Hi there',
        code: null,
      })

      const { status, body } = await req<{ emails: { subject: string }[] }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/inbox`, { agent },
      )

      expect(status).toBe(200)
      expect(body.emails.length).toBe(2)
    })

    it('returns 404 when agent has no hosted mailbox', async () => {
      const agent = createTestAgent('nobox@local')
      grantDefaultScopes(agent.agent_id)

      const { status } = await req(
        app, 'GET', `/v1/agents/${agent.agent_id}/inbox`, { agent },
      )

      expect(status).toBe(404)
    })
  })

  describe('GET /v1/agents/:id/inbox/search', () => {
    it('searches inbound emails by query string', async () => {
      const agent = createTestAgent('search@local')
      grantDefaultScopes(agent.agent_id)
      bindMailbox(agent.agent_id, 'search@agenova.chat')

      seedInboundEmail(agent.agent_id, 'search@agenova.chat', { subject: 'Welcome to GitHub' })
      seedInboundEmail(agent.agent_id, 'search@agenova.chat', { subject: 'Stripe invoice' })

      const { status, body } = await req<{ emails: { subject: string }[] }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/inbox/search?q=GitHub`, { agent },
      )

      expect(status).toBe(200)
      expect(body.emails.length).toBe(1)
      expect(body.emails[0].subject).toBe('Welcome to GitHub')
    })
  })

  describe('GET /v1/agents/:id/inbox/code', () => {
    it('returns the latest verification code', async () => {
      const agent = createTestAgent('code@local')
      grantDefaultScopes(agent.agent_id)
      bindMailbox(agent.agent_id, 'code@agenova.chat')

      seedInboundEmail(agent.agent_id, 'code@agenova.chat', {
        code: '123456',
        subject: 'Verify',
      })

      const { status, body } = await req<{ code: string; from: string; subject: string }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/inbox/code`, { agent },
      )

      expect(status).toBe(200)
      expect(body.code).toBe('123456')
      expect(body.subject).toBe('Verify')
    })

    it('returns null when no code emails exist', async () => {
      const agent = createTestAgent('nocode@local')
      grantDefaultScopes(agent.agent_id)
      bindMailbox(agent.agent_id, 'nocode@agenova.chat')

      const { status, body } = await req<{ code: null }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/inbox/code`, { agent },
      )

      expect(status).toBe(200)
      expect(body.code).toBeNull()
    })
  })
})

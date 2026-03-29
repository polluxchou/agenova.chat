// ---------------------------------------------------------------------------
// Hosted API — Inbox route tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, req, TEST_TOKEN, insertTestEmail } from './helpers.js'
import { createApp } from '../src/app.js'

const app = createApp()

describe('Hosted API — Inbox routes', () => {
  beforeEach(() => setupTest())
  afterEach(() => teardownTest())

  it('GET /v1/inbox returns emails for a mailbox', async () => {
    insertTestEmail({ mailbox: 'alice@agenova.chat', subject: 'Hello' })
    insertTestEmail({ mailbox: 'alice@agenova.chat', subject: 'World' })
    insertTestEmail({ mailbox: 'bob@agenova.chat', subject: 'Other' })

    const res = await req<{ emails: any[] }>(app, 'GET', '/v1/inbox?mailbox=alice@agenova.chat', {
      token: TEST_TOKEN,
    })

    expect(res.status).toBe(200)
    expect(res.body.emails.length).toBe(2)
  })

  it('requires ?mailbox= query param', async () => {
    const res = await req(app, 'GET', '/v1/inbox', { token: TEST_TOKEN })

    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('MISSING_FIELDS')
  })

  it('requires Bearer token', async () => {
    const res = await req(app, 'GET', '/v1/inbox?mailbox=alice@agenova.chat')

    expect(res.status).toBe(401)
    expect((res.body as any).code).toBe('UNAUTHORIZED')
  })

  it('filters by since= timestamp', async () => {
    insertTestEmail({
      mailbox: 'alice@agenova.chat',
      subject: 'Old',
      received_at: '2024-01-01T00:00:00Z',
    })
    insertTestEmail({
      mailbox: 'alice@agenova.chat',
      subject: 'New',
      received_at: '2024-06-01T00:00:00Z',
    })

    const res = await req<{ emails: any[] }>(
      app, 'GET', '/v1/inbox?mailbox=alice@agenova.chat&since=2024-03-01T00:00:00Z', {
        token: TEST_TOKEN,
      },
    )

    expect(res.status).toBe(200)
    expect(res.body.emails.length).toBe(1)
    expect(res.body.emails[0].subject).toBe('New')
  })

  it('respects limit= param', async () => {
    for (let i = 0; i < 10; i++) {
      insertTestEmail({ mailbox: 'alice@agenova.chat', subject: `Email ${i}` })
    }

    const res = await req<{ emails: any[] }>(
      app, 'GET', '/v1/inbox?mailbox=alice@agenova.chat&limit=3', {
        token: TEST_TOKEN,
      },
    )

    expect(res.status).toBe(200)
    expect(res.body.emails.length).toBe(3)
  })

  it('returns empty array for unknown mailbox', async () => {
    const res = await req<{ emails: any[] }>(
      app, 'GET', '/v1/inbox?mailbox=nobody@agenova.chat', {
        token: TEST_TOKEN,
      },
    )

    expect(res.status).toBe(200)
    expect(res.body.emails.length).toBe(0)
  })

  it('email objects contain expected fields', async () => {
    insertTestEmail({
      mailbox: 'alice@agenova.chat',
      subject: 'Detail check',
      body_text: 'Full body',
      from_address: 'sender@test.com',
    })

    const res = await req<{ emails: any[] }>(
      app, 'GET', '/v1/inbox?mailbox=alice@agenova.chat', { token: TEST_TOKEN },
    )

    const email = res.body.emails[0]
    expect(email.id).toBeString()
    expect(email.from_address).toBe('sender@test.com')
    expect(email.subject).toBe('Detail check')
    expect(email.body_text).toBe('Full body')
    expect(email.received_at).toBeString()
  })
})

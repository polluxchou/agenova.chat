// ---------------------------------------------------------------------------
// Hosted API — Webhook inbound tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, req, insertClaim } from './helpers.js'
import { createApp } from '../src/app.js'
import { dbGet, dbAll } from '../src/db/client.js'

const app = createApp()

describe('Hosted API — Webhook routes', () => {
  beforeEach(() => setupTest())
  afterEach(() => teardownTest())

  it('POST /v1/webhook/inbound stores email in DB', async () => {
    const res = await req<{ id: string; mailbox: string }>(
      app, 'POST', '/v1/webhook/inbound', {
        body: {
          from_address: 'sender@example.com',
          from_name: 'Sender',
          to_address: 'alice@agenova.chat',
          subject: 'Test webhook',
          body_text: 'Webhook body',
        },
      },
    )

    expect(res.status).toBe(201)
    expect(res.body.id).toBeString()
    expect(res.body.mailbox).toBe('alice@agenova.chat')

    // Verify in DB
    const row = dbGet<{ subject: string; from_address: string }>(
      `SELECT subject, from_address FROM emails WHERE id = ?`,
      res.body.id,
    )
    expect(row?.subject).toBe('Test webhook')
    expect(row?.from_address).toBe('sender@example.com')
  })

  it('rejects missing required fields', async () => {
    const res = await req(app, 'POST', '/v1/webhook/inbound', {
      body: { subject: 'No from/to' },
    })

    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('MISSING_FIELDS')
  })

  it('stores email even without active mailbox claim', async () => {
    const res = await req(app, 'POST', '/v1/webhook/inbound', {
      body: {
        from_address: 'sender@example.com',
        to_address: 'unclaimed@agenova.chat',
        subject: 'To unclaimed',
      },
    })

    expect(res.status).toBe(201)
  })

  it('validates webhook secret when configured', async () => {
    process.env.AGENOVA_WEBHOOK_SECRET = 'my-secret'

    // Without secret — rejected
    const res1 = await req(app, 'POST', '/v1/webhook/inbound', {
      body: {
        from_address: 'a@b.com',
        to_address: 'c@d.com',
      },
    })
    expect(res1.status).toBe(401)

    // With correct secret — accepted
    const res2 = await req(app, 'POST', '/v1/webhook/inbound', {
      body: {
        from_address: 'a@b.com',
        to_address: 'c@d.com',
      },
      headers: { 'x-webhook-secret': 'my-secret' },
    })
    expect(res2.status).toBe(201)

    delete process.env.AGENOVA_WEBHOOK_SECRET
  })

  it('email becomes available via inbox route', async () => {
    // Webhook in
    await req(app, 'POST', '/v1/webhook/inbound', {
      body: {
        from_address: 'sender@example.com',
        to_address: 'alice@agenova.chat',
        subject: 'E2E webhook → inbox',
        body_text: 'Should appear in inbox',
      },
    })

    // Fetch via inbox
    const inboxRes = await req<{ emails: any[] }>(
      app, 'GET', '/v1/inbox?mailbox=alice@agenova.chat', {
        token: process.env.AGENOVA_DEV_TOKEN!,
      },
    )

    expect(inboxRes.status).toBe(200)
    expect(inboxRes.body.emails.length).toBe(1)
    expect(inboxRes.body.emails[0].subject).toBe('E2E webhook → inbox')
  })
})

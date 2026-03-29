// ---------------------------------------------------------------------------
// Hosted API — Send route tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, req, TEST_TOKEN } from './helpers.js'
import { createApp } from '../src/app.js'
import { dbGet, dbAll } from '../src/db/client.js'

const app = createApp()

describe('Hosted API — Send routes', () => {
  beforeEach(() => setupTest())
  afterEach(() => teardownTest())

  it('POST /v1/send queues outbound email and returns id', async () => {
    const res = await req<{ id: string }>(app, 'POST', '/v1/send', {
      token: TEST_TOKEN,
      body: {
        from: 'alice@agenova.chat',
        to: ['bob@example.com'],
        subject: 'Hello Bob',
        text: 'Hi there',
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.id).toBeString()

    // Check it's in the queue
    const row = dbGet<{ from_mailbox: string; status: string }>(
      `SELECT from_mailbox, status FROM outbound_queue WHERE id = ?`,
      res.body.id,
    )
    expect(row?.from_mailbox).toBe('alice@agenova.chat')
    expect(row?.status).toBe('queued')
  })

  it('requires from and to fields', async () => {
    const res = await req(app, 'POST', '/v1/send', {
      token: TEST_TOKEN,
      body: { subject: 'No from or to' },
    })

    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('MISSING_FIELDS')
  })

  it('requires Bearer token', async () => {
    const res = await req(app, 'POST', '/v1/send', {
      body: { from: 'a@b.com', to: ['c@d.com'] },
    })

    expect(res.status).toBe(401)
  })

  it('stores multiple recipients as JSON array', async () => {
    const res = await req<{ id: string }>(app, 'POST', '/v1/send', {
      token: TEST_TOKEN,
      body: {
        from: 'alice@agenova.chat',
        to: ['bob@example.com', 'carol@example.com'],
        subject: 'Multi',
      },
    })

    const row = dbGet<{ to_addresses: string }>(
      `SELECT to_addresses FROM outbound_queue WHERE id = ?`,
      res.body.id,
    )
    const parsed = JSON.parse(row!.to_addresses)
    expect(parsed).toEqual(['bob@example.com', 'carol@example.com'])
  })

  it('stores HTML body when provided', async () => {
    const res = await req<{ id: string }>(app, 'POST', '/v1/send', {
      token: TEST_TOKEN,
      body: {
        from: 'alice@agenova.chat',
        to: ['bob@example.com'],
        subject: 'HTML test',
        html: '<h1>Hello</h1>',
      },
    })

    const row = dbGet<{ body_html: string }>(
      `SELECT body_html FROM outbound_queue WHERE id = ?`,
      res.body.id,
    )
    expect(row?.body_html).toBe('<h1>Hello</h1>')
  })
})

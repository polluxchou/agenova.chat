// ---------------------------------------------------------------------------
// Outbound delivery worker tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest } from './helpers.js'
import { dbRun, dbGet } from '../src/db/client.js'
import {
  ResendProvider,
  MailgunProvider,
  runDeliveryTick,
  resetStuckJobs,
  _resetDeliveryWorker,
  type OutboundJob,
  type DeliveryResult,
  type EmailProvider,
} from '../src/delivery.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertJob(opts: {
  id?: string
  from?: string
  to?: string[]
  subject?: string
  text?: string
  html?: string
  status?: string
}): string {
  const id = opts.id ?? crypto.randomUUID()
  const now = new Date().toISOString()
  dbRun(
    `INSERT INTO outbound_queue (id, from_mailbox, to_addresses, subject, body_text, body_html, headers, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
    id,
    opts.from ?? 'alice@agenova.chat',
    JSON.stringify(opts.to ?? ['bob@example.com']),
    opts.subject ?? 'Test Subject',
    opts.text ?? 'Hello from test',
    opts.html ?? '',
    opts.status ?? 'queued',
    now,
    now,
  )
  return id
}

function getJob(id: string) {
  return dbGet<{ status: string; error: string | null }>(
    `SELECT status, error FROM outbound_queue WHERE id = ?`,
    id,
  )
}

// A mock provider that captures calls and returns a configurable result
class MockProvider implements EmailProvider {
  readonly name = 'mock'
  calls: OutboundJob[] = []
  result: DeliveryResult = { ok: true }

  async send(job: OutboundJob): Promise<DeliveryResult> {
    this.calls.push(job)
    return this.result
  }
}

// ---------------------------------------------------------------------------
// Delivery tick tests
// ---------------------------------------------------------------------------

describe('Hosted API — Delivery worker', () => {
  let mock: MockProvider

  beforeEach(() => {
    setupTest()
    mock = new MockProvider()
  })

  afterEach(() => {
    _resetDeliveryWorker()
    teardownTest()
  })

  it('delivers a queued job and marks it sent', async () => {
    const id = insertJob({})

    await runDeliveryTick(mock)

    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].id).toBe(id)
    expect(getJob(id)?.status).toBe('sent')
  })

  it('marks job failed when provider returns ok=false', async () => {
    mock.result = { ok: false, error: 'Resend error 422: invalid address' }
    const id = insertJob({})

    await runDeliveryTick(mock)

    const job = getJob(id)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('Resend error 422')
  })

  it('marks job failed when provider throws', async () => {
    mock.send = async () => { throw new Error('Network timeout') }
    const id = insertJob({})

    await runDeliveryTick(mock)

    const job = getJob(id)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('Network timeout')
  })

  it('processes multiple queued jobs in one tick', async () => {
    const id1 = insertJob({ to: ['a@example.com'] })
    const id2 = insertJob({ to: ['b@example.com'] })
    const id3 = insertJob({ to: ['c@example.com'] })

    await runDeliveryTick(mock)

    expect(mock.calls).toHaveLength(3)
    expect(getJob(id1)?.status).toBe('sent')
    expect(getJob(id2)?.status).toBe('sent')
    expect(getJob(id3)?.status).toBe('sent')
  })

  it('does not re-process already-sent jobs', async () => {
    const id = insertJob({ status: 'sent' })

    await runDeliveryTick(mock)

    expect(mock.calls).toHaveLength(0)
    expect(getJob(id)?.status).toBe('sent')  // unchanged
  })

  it('does not process failed jobs (manual retry required)', async () => {
    const id = insertJob({ status: 'failed' })

    await runDeliveryTick(mock)

    expect(mock.calls).toHaveLength(0)
    expect(getJob(id)?.status).toBe('failed')  // unchanged
  })

  it('respects batchSize limit', async () => {
    insertJob({})
    insertJob({})
    insertJob({})

    await runDeliveryTick(mock, 2)  // batchSize=2

    expect(mock.calls).toHaveLength(2)
  })

  it('passes correct job fields to provider', async () => {
    insertJob({
      from: 'sender@agenova.chat',
      to: ['r1@example.com', 'r2@example.com'],
      subject: 'Important',
      text: 'Plain text',
      html: '<b>Bold</b>',
    })

    await runDeliveryTick(mock)

    const sent = mock.calls[0]
    expect(sent.from_mailbox).toBe('sender@agenova.chat')
    expect(JSON.parse(sent.to_addresses)).toEqual(['r1@example.com', 'r2@example.com'])
    expect(sent.subject).toBe('Important')
    expect(sent.body_text).toBe('Plain text')
    expect(sent.body_html).toBe('<b>Bold</b>')
  })
})

// ---------------------------------------------------------------------------
// resetStuckJobs tests
// ---------------------------------------------------------------------------

describe('Hosted API — resetStuckJobs()', () => {
  beforeEach(() => setupTest())
  afterEach(() => {
    _resetDeliveryWorker()
    teardownTest()
  })

  it('resets sending → queued so orphaned jobs can be retried', () => {
    const id = insertJob({ status: 'sending' })

    resetStuckJobs()

    expect(getJob(id)?.status).toBe('queued')
  })

  it('does not touch sent or failed jobs', () => {
    const sentId   = insertJob({ status: 'sent' })
    const failedId = insertJob({ status: 'failed' })

    resetStuckJobs()

    expect(getJob(sentId)?.status).toBe('sent')
    expect(getJob(failedId)?.status).toBe('failed')
  })
})

// ---------------------------------------------------------------------------
// ResendProvider HTTP shape tests
// ---------------------------------------------------------------------------

describe('Hosted API — ResendProvider (mocked fetch)', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    setupTest()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    _resetDeliveryWorker()
    teardownTest()
  })

  it('sends correct Authorization header and body shape', async () => {
    const captured: { url: string; init: RequestInit }[] = []

    globalThis.fetch = async (input, init) => {
      captured.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 })
    }

    const provider = new ResendProvider('test-resend-key', 'https://api.resend.com')
    const job: OutboundJob = {
      id: 'j1',
      from_mailbox: 'alice@agenova.chat',
      to_addresses: '["bob@example.com"]',
      subject: 'Hello',
      body_text: 'Hi Bob',
      body_html: '',
      headers: '{}',
      status: 'queued',
      created_at: new Date().toISOString(),
    }

    const result = await provider.send(job)

    expect(result.ok).toBe(true)
    expect(captured[0].url).toBe('https://api.resend.com/emails')
    expect(captured[0].init.headers?.['Authorization']).toBe('Bearer test-resend-key')

    const body = JSON.parse(captured[0].init.body as string)
    expect(body.from).toBe('alice@agenova.chat')
    expect(body.to).toEqual(['bob@example.com'])
    expect(body.subject).toBe('Hello')
    expect(body.text).toBe('Hi Bob')
  })

  it('returns ok=false on 4xx and captures the error message', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 })

    const provider = new ResendProvider('bad-key')
    const job: OutboundJob = {
      id: 'j2', from_mailbox: 'a@agenova.chat', to_addresses: '["b@b.com"]',
      subject: '', body_text: '', body_html: '', headers: '{}',
      status: 'queued', created_at: new Date().toISOString(),
    }

    const result = await provider.send(job)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })
})

// ---------------------------------------------------------------------------
// MailgunProvider HTTP shape tests
// ---------------------------------------------------------------------------

describe('Hosted API — MailgunProvider (mocked fetch)', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    setupTest()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    _resetDeliveryWorker()
    teardownTest()
  })

  it('sends Basic auth and form-encoded body', async () => {
    const captured: { url: string; init: RequestInit }[] = []

    globalThis.fetch = async (input, init) => {
      captured.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({ id: '<mg-1@sandbox.mailgun.org>', message: 'Queued.' }), { status: 200 })
    }

    const provider = new MailgunProvider('mg-api-key', 'sandbox.mailgun.org', 'https://api.mailgun.net')
    const job: OutboundJob = {
      id: 'j3',
      from_mailbox: 'alice@agenova.chat',
      to_addresses: '["charlie@example.com","dave@example.com"]',
      subject: 'MG Test',
      body_text: 'Text body',
      body_html: '<p>HTML body</p>',
      headers: '{}',
      status: 'queued',
      created_at: new Date().toISOString(),
    }

    const result = await provider.send(job)

    expect(result.ok).toBe(true)
    expect(captured[0].url).toContain('sandbox.mailgun.org/messages')

    const authHeader = captured[0].init.headers?.['Authorization'] as string
    expect(authHeader).toStartWith('Basic ')

    // Decode and verify credentials
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString()
    expect(decoded).toBe('api:mg-api-key')

    const body = new URLSearchParams(captured[0].init.body as string)
    expect(body.get('from')).toBe('alice@agenova.chat')
    expect(body.get('to')).toBe('charlie@example.com,dave@example.com')
    expect(body.get('subject')).toBe('MG Test')
    expect(body.get('text')).toBe('Text body')
    expect(body.get('html')).toBe('<p>HTML body</p>')
  })

  it('returns ok=false on Mailgun error', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Domain not found' }), { status: 404 })

    const provider = new MailgunProvider('key', 'bad.domain.com')
    const job: OutboundJob = {
      id: 'j4', from_mailbox: 'a@agenova.chat', to_addresses: '["b@b.com"]',
      subject: '', body_text: '', body_html: '', headers: '{}',
      status: 'queued', created_at: new Date().toISOString(),
    }

    const result = await provider.send(job)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('404')
  })
})

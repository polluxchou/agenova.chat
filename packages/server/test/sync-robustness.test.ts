// Phase 5 — Sync robustness tests
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent } from './helpers.js'
import { _setFetch } from '../src/hosted/client.js'
import { syncMailbox, startSyncLoop, _resetSyncLoop } from '../src/modules/hosted-sync/index.js'
import { bindMailbox } from '../src/modules/mailbox-claim/index.js'
import { getEmails, saveEmail } from '../src/modules/inbound-mail/index.js'
import { randomUuid } from '../src/crypto.js'
import { dbGet } from '../src/db/client.js'

describe('Phase 5 — Sync robustness', () => {
  beforeEach(() => {
    setupTest()
    process.env.AGENOVA_API_TOKEN = 'test-token'
  })

  afterEach(() => {
    _setFetch(undefined)
    _resetSyncLoop()
    delete process.env.AGENOVA_API_TOKEN
    delete process.env.AGENOVA_SYNC_INTERVAL_MS
    teardownTest()
  })

  // -------------------------------------------------------------------------
  // Test 1: Deduplication — same email id synced twice stores only once
  // -------------------------------------------------------------------------

  it('deduplication — same email id synced twice stores only once', async () => {
    const agent = createTestAgent('dedup-sync@local', 'Dedup Agent')
    const mailbox = 'dedup-sync@agenova.chat'
    bindMailbox(agent.agent_id, mailbox)

    const fixedId = randomUuid()
    const mockEmail = {
      id: fixedId,
      from_address: 'sender@example.com',
      from_name: 'Sender',
      to_address: mailbox,
      subject: 'Duplicate test',
      body_text: 'Test body',
      received_at: '2024-06-01T00:00:00Z',
      created_at: '2024-06-01T00:00:00Z',
    }

    _setFetch(async () =>
      new Response(JSON.stringify({ emails: [mockEmail] }), { status: 200 }) as any
    )

    await syncMailbox(mailbox, 'test-token')
    await syncMailbox(mailbox, 'test-token')

    const emails = getEmails(mailbox)
    expect(emails.length).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Test 2: sync_cursor written after successful sync
  // -------------------------------------------------------------------------

  it('sync_cursor written after successful sync', async () => {
    const agent = createTestAgent('cursor-sync@local', 'Cursor Agent')
    const mailbox = 'cursor-sync@agenova.chat'
    bindMailbox(agent.agent_id, mailbox)

    const receivedAt = '2024-06-01T00:00:00Z'
    _setFetch(async () =>
      new Response(JSON.stringify({
        emails: [{
          id: randomUuid(),
          from_address: 'sender@example.com',
          from_name: 'Sender',
          to_address: mailbox,
          subject: 'Cursor test',
          body_text: 'Test body',
          received_at: receivedAt,
          created_at: receivedAt,
        }],
      }), { status: 200 }) as any
    )

    await syncMailbox(mailbox, 'test-token')

    const row = dbGet<{ sync_cursor: string }>(
      `SELECT sync_cursor FROM agents WHERE hosted_mailbox = ?`,
      mailbox,
    )
    expect(row?.sync_cursor).toBe(receivedAt)
  })

  // -------------------------------------------------------------------------
  // Test 3: sync_cursor used as since= on second call
  // -------------------------------------------------------------------------

  it('sync_cursor used as since= on second call', async () => {
    const agent = createTestAgent('since-sync@local', 'Since Agent')
    const mailbox = 'since-sync@agenova.chat'
    bindMailbox(agent.agent_id, mailbox)

    const calls: string[] = []

    _setFetch(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      calls.push(url)
      return new Response(JSON.stringify({
        emails: [{
          id: randomUuid(),
          from_address: 'sender@example.com',
          from_name: 'Sender',
          to_address: mailbox,
          subject: 'Since test',
          body_text: 'Test body',
          received_at: '2024-06-01T00:00:00Z',
          created_at: '2024-06-01T00:00:00Z',
        }],
      }), { status: 200 }) as any
    })

    // First sync
    await syncMailbox(mailbox, 'test-token')

    // Second sync
    await syncMailbox(mailbox, 'test-token')

    // The second call's URL should contain the since= cursor
    expect(calls.length).toBe(2)
    expect(calls[1]).toContain('since=2024-06-01')
  })

  // -------------------------------------------------------------------------
  // Test 4: sync_cursor not updated on empty sync
  // -------------------------------------------------------------------------

  it('sync_cursor not updated on empty sync', async () => {
    const agent = createTestAgent('empty-cursor@local', 'Empty Cursor Agent')
    const mailbox = 'empty-cursor@agenova.chat'
    bindMailbox(agent.agent_id, mailbox)

    _setFetch(async () =>
      new Response(JSON.stringify({ emails: [] }), { status: 200 }) as any
    )

    await syncMailbox(mailbox, 'test-token')

    const row = dbGet<{ sync_cursor: string | null }>(
      `SELECT sync_cursor FROM agents WHERE hosted_mailbox = ?`,
      mailbox,
    )
    expect(row?.sync_cursor).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Test 5: AGENOVA_SYNC_INTERVAL_MS env var accepted
  // -------------------------------------------------------------------------

  it('AGENOVA_SYNC_INTERVAL_MS env var accepted', () => {
    process.env.AGENOVA_SYNC_INTERVAL_MS = '999'

    _setFetch(async () =>
      new Response(JSON.stringify({ emails: [] }), { status: 200 }) as any
    )

    // Should not throw
    expect(() => startSyncLoop()).not.toThrow()
    _resetSyncLoop()
  })

  // -------------------------------------------------------------------------
  // Test 6: saveEmail INSERT OR IGNORE — direct duplicate call
  // -------------------------------------------------------------------------

  it('saveEmail INSERT OR IGNORE — direct duplicate call stores only once', () => {
    const agent = createTestAgent('dedup-direct@local', 'Dedup Direct')
    const mailbox = 'dedup@agenova.chat'
    bindMailbox(agent.agent_id, mailbox)

    const fixedId = randomUuid()
    const email = {
      id: fixedId,
      mailbox,
      agent_id: agent.agent_id,
      from_address: 'sender@example.com',
      from_name: 'Sender',
      to_address: mailbox,
      subject: 'Direct dedup',
      body_text: 'Body',
      body_html: '',
      code: null,
      headers: {},
      metadata: {},
      message_id: null,
      has_attachments: false,
      attachment_count: 0,
      attachment_names: '',
      attachment_search_text: '',
      direction: 'inbound' as const,
      status: 'received' as const,
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    saveEmail(email)
    saveEmail(email)

    const emails = getEmails(mailbox)
    expect(emails.length).toBe(1)
  })
})

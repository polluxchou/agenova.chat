// ---------------------------------------------------------------------------
// Hosted API test helpers
// ---------------------------------------------------------------------------

import { _createTestDb, _resetDb, dbRun } from '../src/db/client.js'
import { sha256 } from '../src/crypto.js'
import { createApp } from '../src/app.js'
import type { Hono } from 'hono'

// Default dev token for tests
export const TEST_TOKEN = 'test-api-token-12345'

export function setupTest(): void {
  _createTestDb()
  // Set dev token env for auth middleware
  process.env.AGENOVA_DEV_TOKEN = TEST_TOKEN
}

export function teardownTest(): void {
  _resetDb()
  delete process.env.AGENOVA_DEV_TOKEN
}

/**
 * Register a hashed API token in the DB (production auth path).
 */
export function registerToken(token: string): void {
  const hash = sha256(token)
  dbRun(
    `INSERT INTO api_tokens (token_hash, label, status, created_at) VALUES (?, 'test', 'active', ?)`,
    hash,
    new Date().toISOString(),
  )
}

/**
 * Insert a test email directly into the hosted DB.
 */
export function insertTestEmail(opts: {
  id?: string
  mailbox: string
  from_address?: string
  to_address?: string
  subject?: string
  body_text?: string
  received_at?: string
}): string {
  const id = opts.id ?? crypto.randomUUID()
  const now = new Date().toISOString()
  dbRun(
    `INSERT INTO emails (id, mailbox, from_address, from_name, to_address, subject, body_text, body_html,
                         received_at, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, '', ?, ?)`,
    id,
    opts.mailbox,
    opts.from_address ?? 'sender@example.com',
    opts.to_address ?? opts.mailbox,
    opts.subject ?? 'Test Subject',
    opts.body_text ?? 'Test body',
    opts.received_at ?? now,
    now,
  )
  return id
}

/**
 * Insert a mailbox claim directly into the hosted DB.
 */
export function insertClaim(opts: {
  handle: string
  hosted_mailbox: string
  agent_id: string
  public_key: string
}): void {
  const now = new Date().toISOString()
  dbRun(
    `INSERT INTO mailbox_claims (handle, hosted_mailbox, agent_id, public_key, status, claimed_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    opts.handle,
    opts.hosted_mailbox,
    opts.agent_id,
    opts.public_key,
    now,
    now,
  )
}

/**
 * HTTP request helper for Hono test apps.
 */
export async function req<T = unknown>(
  app: Hono,
  method: string,
  path: string,
  opts: {
    body?: unknown
    token?: string
    headers?: Record<string, string>
  } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opts.headers,
  }

  if (opts.token) {
    headers['authorization'] = `Bearer ${opts.token}`
  }

  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined

  const res = await app.request(path, {
    method,
    headers,
    body: bodyStr,
  })

  const body = await res.json().catch(() => null) as T
  return { status: res.status, body }
}

// ---------------------------------------------------------------------------
// Test helpers and fixtures
//
// Every test that touches the DB or crypto must call setupTest() in
// beforeEach and teardownTest() in afterEach to guarantee isolation.
// ---------------------------------------------------------------------------

import { _createTestDb, _resetDb } from '../src/db/client.js'
import { _resetMasterKey, generateEd25519Keypair, deriveAgentId, signMessage } from '../src/crypto.js'
import { createAgent } from '../src/modules/identity/index.js'
import { grantScope } from '../src/modules/policy/index.js'
import { SCOPES } from '../src/types.js'

// Fixed test master key — deterministic encryption across test runs
const TEST_MASTER_KEY = Buffer.alloc(32, 0xab)

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function setupTest(): void {
  _resetMasterKey(TEST_MASTER_KEY)
  _createTestDb()
}

export function teardownTest(): void {
  _resetDb()
  _resetMasterKey()
}

// ---------------------------------------------------------------------------
// Agent fixture — creates an agent and returns keys + full agent record
// ---------------------------------------------------------------------------

export interface TestAgent {
  agent_id: string
  email_address: string
  public_key: string       // "ed25519:<base64>"
  public_key_raw: string   // raw base64 (without prefix)
  private_key: string      // raw base64 seed
}

export function createTestAgent(email = 'test@local', displayName = 'Test Agent'): TestAgent {
  const result = createAgent({ email_address: email, display_name: displayName })
  const public_key_raw = result.agent.public_key.slice('ed25519:'.length)

  return {
    agent_id: result.agent.agent_id,
    email_address: result.agent.email_address,
    public_key: result.agent.public_key,
    public_key_raw,
    private_key: result.private_key,
  }
}

/**
 * Grant the full default scope set to an agent so route tests can
 * pass the policy guard without additional setup.
 */
export function grantDefaultScopes(agent_id: string): void {
  const scopes = Object.values(SCOPES)
  for (const scope of scopes) {
    grantScope({ agent_id, scope, granted_by: agent_id })
  }
}

// ---------------------------------------------------------------------------
// Auth header builder — produces valid X-Agent-Id / X-Signature / X-Timestamp
// headers for a given request, matching the auth middleware's expected format.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'

export function buildAuthHeaders(
  agent: TestAgent,
  method: string,
  path: string,
  body: string = '',
): Record<string, string> {
  const timestamp = new Date().toISOString()
  const bodyHash = body.length > 0
    ? createHash('sha256').update(body, 'utf-8').digest('hex')
    : ''

  // Strip query params — auth middleware uses pathname only
  const pathname = path.split('?')[0]
  const signingPayload = `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${bodyHash}`
  const signature = signMessage(signingPayload, agent.private_key, agent.public_key_raw)

  return {
    'x-agent-id': agent.agent_id,
    'x-signature': signature,
    'x-timestamp': timestamp,
    'content-type': 'application/json',
  }
}

// ---------------------------------------------------------------------------
// Request helper — sends a request to a Hono app and returns parsed JSON
// ---------------------------------------------------------------------------

import type { Hono } from 'hono'

export async function req<T = unknown>(
  app: Hono,
  method: string,
  path: string,
  opts: {
    agent?: TestAgent
    body?: unknown
  } = {},
): Promise<{ status: number; body: T }> {
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : ''
  const headers: Record<string, string> = {}

  if (opts.agent) {
    Object.assign(headers, buildAuthHeaders(opts.agent, method, path, bodyStr))
  }

  const res = await app.request(path, {
    method,
    headers,
    body: bodyStr || undefined,
  })

  const body = await res.json().catch(() => null) as T
  return { status: res.status, body }
}

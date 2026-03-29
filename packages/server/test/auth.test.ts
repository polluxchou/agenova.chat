// ---------------------------------------------------------------------------
// Auth middleware tests
//
// Covers: missing headers, invalid signature, replayed timestamp,
//         suspended/revoked agent rejection, and valid request passthrough.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, buildAuthHeaders, req } from './helpers.js'
import { createApp } from '../src/app.js'
import { suspendAgent, revokeAgent } from '../src/modules/identity/index.js'
import { createHash } from 'node:crypto'
import { signMessage } from '../src/crypto.js'

const app = createApp({ enableLogger: false })

describe('auth middleware', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // -------------------------------------------------------------------------
  // Missing headers
  // -------------------------------------------------------------------------

  it('returns 401 when all auth headers are missing', async () => {
    const { status } = await req(app, 'GET', '/v1/agents/some-id')
    expect(status).toBe(401)
  })

  it('returns 401 when X-Signature is missing', async () => {
    const agent = createTestAgent()
    const res = await app.request(`/v1/agents/${agent.agent_id}`, {
      method: 'GET',
      headers: {
        'x-agent-id': agent.agent_id,
        'x-timestamp': new Date().toISOString(),
      },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-Timestamp is missing', async () => {
    const agent = createTestAgent()
    const res = await app.request(`/v1/agents/${agent.agent_id}`, {
      method: 'GET',
      headers: {
        'x-agent-id': agent.agent_id,
        'x-signature': 'invalidsig',
      },
    })
    expect(res.status).toBe(401)
  })

  // -------------------------------------------------------------------------
  // Timestamp replay protection
  // -------------------------------------------------------------------------

  it('returns 401 for a timestamp more than 5 minutes in the past', async () => {
    const agent = createTestAgent()
    const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    const signingPayload = `GET\n/v1/agents/${agent.agent_id}\n${oldTimestamp}\n`
    const signature = signMessage(signingPayload, agent.private_key, agent.public_key_raw)

    const res = await app.request(`/v1/agents/${agent.agent_id}`, {
      method: 'GET',
      headers: {
        'x-agent-id': agent.agent_id,
        'x-signature': signature,
        'x-timestamp': oldTimestamp,
      },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for a timestamp more than 5 minutes in the future', async () => {
    const agent = createTestAgent()
    const futureTimestamp = new Date(Date.now() + 6 * 60 * 1000).toISOString()
    const signingPayload = `GET\n/v1/agents/${agent.agent_id}\n${futureTimestamp}\n`
    const signature = signMessage(signingPayload, agent.private_key, agent.public_key_raw)

    const res = await app.request(`/v1/agents/${agent.agent_id}`, {
      method: 'GET',
      headers: {
        'x-agent-id': agent.agent_id,
        'x-signature': signature,
        'x-timestamp': futureTimestamp,
      },
    })
    expect(res.status).toBe(401)
  })

  // -------------------------------------------------------------------------
  // Signature verification
  // -------------------------------------------------------------------------

  it('returns 401 for a tampered signature', async () => {
    const agent = createTestAgent()
    const headers = buildAuthHeaders(agent, 'GET', `/v1/agents/${agent.agent_id}`)
    // Corrupt the signature
    headers['x-signature'] = Buffer.alloc(64, 0xff).toString('base64')

    const res = await app.request(`/v1/agents/${agent.agent_id}`, {
      method: 'GET',
      headers,
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when signature is for a different path', async () => {
    const agent = createTestAgent()
    // Sign for /v1/agents but request /v1/agents/something-else
    const headers = buildAuthHeaders(agent, 'GET', '/v1/agents')
    const res = await app.request(`/v1/agents/${agent.agent_id}`, {
      method: 'GET',
      headers,
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when agent_id in header does not exist', async () => {
    const agent = createTestAgent()
    const path = '/v1/agents/nonexistent-id'
    const headers = buildAuthHeaders(agent, 'GET', path)
    // Override the agent-id with an unknown one
    headers['x-agent-id'] = '00000000-0000-0000-0000-000000000000'

    const res = await app.request(path, { method: 'GET', headers })
    expect(res.status).toBe(401)
  })

  // -------------------------------------------------------------------------
  // Agent status checks
  // -------------------------------------------------------------------------

  it('returns 401 for a suspended agent', async () => {
    const agent = createTestAgent()
    suspendAgent(agent.agent_id)

    const { status } = await req(app, 'GET', `/v1/agents/${agent.agent_id}`, { agent })
    expect(status).toBe(401)
  })

  it('returns 401 for a revoked agent', async () => {
    const agent = createTestAgent()
    revokeAgent(agent.agent_id)

    const { status } = await req(app, 'GET', `/v1/agents/${agent.agent_id}`, { agent })
    expect(status).toBe(401)
  })

  // -------------------------------------------------------------------------
  // Valid request
  // -------------------------------------------------------------------------

  it('passes through a correctly signed request', async () => {
    const agent = createTestAgent()
    const { status, body } = await req<{ agent: { agent_id: string } }>(
      app, 'GET', `/v1/agents/${agent.agent_id}`, { agent },
    )
    expect(status).toBe(200)
    expect(body.agent.agent_id).toBe(agent.agent_id)
  })

  it('passes through a POST request with a body', async () => {
    const agent = createTestAgent()
    const body = { scope: 'mail.read' }

    const { status } = await req(
      app, 'POST', `/v1/agents/${agent.agent_id}/grants`, { agent, body },
    )
    // 201 created (grant was created) — key point is it wasn't 401
    expect(status).toBe(201)
  })
})

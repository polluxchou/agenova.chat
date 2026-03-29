// ---------------------------------------------------------------------------
// Identity route integration tests
//
// Tests the full HTTP flow: POST /v1/agents, GET /v1/agents/:id,
// GET /v1/agents?email=, DELETE /v1/agents/:id/devices/:did
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, grantDefaultScopes, req } from './helpers.js'
import { createApp } from '../src/app.js'

const app = createApp({ enableLogger: false })

describe('identity routes', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // -------------------------------------------------------------------------
  // POST /v1/agents — create agent (no auth required)
  // -------------------------------------------------------------------------

  describe('POST /v1/agents', () => {
    it('creates a new agent and returns agent + private_key', async () => {
      const res = await app.request('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email_address: 'new@local', display_name: 'New' }),
      })

      expect(res.status).toBe(201)
      const data = await res.json() as { agent: { agent_id: string; email_address: string }; private_key: string }
      expect(data.agent.agent_id).toBeString()
      expect(data.agent.email_address).toBe('new@local')
      expect(data.private_key).toBeString()
      expect(data.private_key.length).toBeGreaterThan(0)
    })

    it('returns 409 for a duplicate email address', async () => {
      await app.request('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email_address: 'dup@local', display_name: 'Dup1' }),
      })

      const res = await app.request('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email_address: 'dup@local', display_name: 'Dup2' }),
      })

      expect(res.status).toBe(409)
    })

    it('returns 400 when email_address is missing', async () => {
      const res = await app.request('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: 'NoEmail' }),
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 when display_name is missing', async () => {
      const res = await app.request('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email_address: 'missing@local' }),
      })

      expect(res.status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // GET /v1/agents/:agentId (auth required)
  // -------------------------------------------------------------------------

  describe('GET /v1/agents/:agentId', () => {
    it('returns the agent for a valid signed request', async () => {
      const agent = createTestAgent()
      const { status, body } = await req<{ agent: { agent_id: string; display_name: string } }>(
        app, 'GET', `/v1/agents/${agent.agent_id}`, { agent },
      )

      expect(status).toBe(200)
      expect(body.agent.agent_id).toBe(agent.agent_id)
    })

    it('returns 404 for a non-existent agent id', async () => {
      const agent = createTestAgent()
      const { status } = await req(
        app, 'GET', '/v1/agents/00000000-0000-0000-0000-000000000000', { agent },
      )

      expect(status).toBe(404)
    })

    it('returns 401 without auth headers', async () => {
      const agent = createTestAgent()
      const res = await app.request(`/v1/agents/${agent.agent_id}`)
      expect(res.status).toBe(401)
    })
  })

  // -------------------------------------------------------------------------
  // GET /v1/agents?email= (auth required)
  // -------------------------------------------------------------------------

  describe('GET /v1/agents?email=', () => {
    it('finds an agent by email address', async () => {
      const agent = createTestAgent('byemail@local')
      const { status, body } = await req<{ agent: { email_address: string } }>(
        app, 'GET', '/v1/agents?email=byemail@local', { agent },
      )

      expect(status).toBe(200)
      expect(body.agent.email_address).toBe('byemail@local')
    })

    it('returns 404 for a non-existent email', async () => {
      const agent = createTestAgent()
      const { status } = await req(
        app, 'GET', '/v1/agents?email=nobody@local', { agent },
      )
      expect(status).toBe(404)
    })

    it('returns 400 when no email query param is provided', async () => {
      const agent = createTestAgent()
      const { status } = await req(app, 'GET', '/v1/agents', { agent })
      expect(status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /v1/agents/:agentId/devices/:deviceId (auth + owner check)
  // -------------------------------------------------------------------------

  describe('DELETE /v1/agents/:agentId/devices/:deviceId', () => {
    it('returns 403 when trying to revoke another agent\'s device', async () => {
      const a1 = createTestAgent('a1@local')
      const a2 = createTestAgent('a2@local')

      // a2 signs the request, but the path targets a1
      const { status } = await req(
        app, 'DELETE', `/v1/agents/${a1.agent_id}/devices/fake-device-id`, { agent: a2 },
      )

      expect(status).toBe(403)
    })
  })

  // -------------------------------------------------------------------------
  // Unauthenticated access (discovery + health)
  // -------------------------------------------------------------------------

  describe('public endpoints', () => {
    it('GET /v1/discovery/info returns node info without auth', async () => {
      const res = await app.request('/v1/discovery/info')
      expect(res.status).toBe(200)
      const data = await res.json() as { node: string; version: string }
      expect(data.node).toBe('agenova-local')
      expect(data.version).toBe('0.1.0')
    })

    it('GET /health returns ok', async () => {
      const res = await app.request('/health')
      expect(res.status).toBe(200)
      const data = await res.json() as { ok: boolean }
      expect(data.ok).toBe(true)
    })
  })
})

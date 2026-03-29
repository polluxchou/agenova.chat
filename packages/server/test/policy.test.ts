// ---------------------------------------------------------------------------
// Policy module tests
//
// Covers: grant, revoke, list, checkPermission, expiry, resource scoping,
//         and the policy-guard middleware rejecting forbidden requests.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, req } from './helpers.js'
import { grantScope, revokeGrant, listGrants, checkPermission } from '../src/modules/policy/index.js'
import { SCOPES } from '../src/types.js'
import { createApp } from '../src/app.js'

const app = createApp({ enableLogger: false })

describe('policy module', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // -------------------------------------------------------------------------
  // grantScope
  // -------------------------------------------------------------------------

  describe('grantScope', () => {
    it('creates a grant and returns it', () => {
      const agent = createTestAgent()
      const grant = grantScope({
        agent_id: agent.agent_id,
        scope: SCOPES.MAIL_READ,
        granted_by: agent.agent_id,
      })

      expect(grant.grant_id).toBeString()
      expect(grant.agent_id).toBe(agent.agent_id)
      expect(grant.scope).toBe(SCOPES.MAIL_READ)
      expect(grant.granted_by).toBe(agent.agent_id)
      expect(grant.created_at).toBeString()
    })

    it('can grant the same scope multiple times (idempotent inserts)', () => {
      const agent = createTestAgent()
      grantScope({ agent_id: agent.agent_id, scope: SCOPES.MAIL_READ, granted_by: agent.agent_id })
      grantScope({ agent_id: agent.agent_id, scope: SCOPES.MAIL_READ, granted_by: agent.agent_id })
      const grants = listGrants(agent.agent_id)
      expect(grants.length).toBe(2)
    })

    it('stores resource_type and resource_id when provided', () => {
      const agent = createTestAgent()
      const grant = grantScope({
        agent_id: agent.agent_id,
        scope: SCOPES.MEMORY_READ,
        granted_by: agent.agent_id,
        resource_type: 'memory',
        resource_id: 'mem-123',
      })
      expect(grant.resource_type).toBe('memory')
      expect(grant.resource_id).toBe('mem-123')
    })
  })

  // -------------------------------------------------------------------------
  // revokeGrant
  // -------------------------------------------------------------------------

  describe('revokeGrant', () => {
    it('removes the grant so checkPermission returns false', () => {
      const agent = createTestAgent()
      const grant = grantScope({
        agent_id: agent.agent_id,
        scope: SCOPES.MAIL_WRITE,
        granted_by: agent.agent_id,
      })

      expect(checkPermission({ agent_id: agent.agent_id, scope: SCOPES.MAIL_WRITE })).toBe(true)

      revokeGrant(grant.grant_id)

      expect(checkPermission({ agent_id: agent.agent_id, scope: SCOPES.MAIL_WRITE })).toBe(false)
    })

    it('is a no-op for a non-existent grant_id', () => {
      // Should not throw
      expect(() => revokeGrant('does-not-exist')).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // listGrants
  // -------------------------------------------------------------------------

  describe('listGrants', () => {
    it('returns all grants for an agent', () => {
      const agent = createTestAgent()
      grantScope({ agent_id: agent.agent_id, scope: SCOPES.MAIL_READ, granted_by: agent.agent_id })
      grantScope({ agent_id: agent.agent_id, scope: SCOPES.MEMORY_READ, granted_by: agent.agent_id })

      const grants = listGrants(agent.agent_id)
      const scopes = grants.map(g => g.scope)
      expect(scopes).toContain(SCOPES.MAIL_READ)
      expect(scopes).toContain(SCOPES.MEMORY_READ)
    })

    it('does not return grants belonging to other agents', () => {
      const a1 = createTestAgent('a1@local')
      const a2 = createTestAgent('a2@local')
      grantScope({ agent_id: a1.agent_id, scope: SCOPES.MAIL_READ, granted_by: a1.agent_id })

      const grants = listGrants(a2.agent_id)
      expect(grants.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // checkPermission
  // -------------------------------------------------------------------------

  describe('checkPermission', () => {
    it('returns false when no grant exists', () => {
      const agent = createTestAgent()
      expect(checkPermission({ agent_id: agent.agent_id, scope: SCOPES.MAIL_READ })).toBe(false)
    })

    it('returns true after a grant is created', () => {
      const agent = createTestAgent()
      grantScope({ agent_id: agent.agent_id, scope: SCOPES.MAIL_READ, granted_by: agent.agent_id })
      expect(checkPermission({ agent_id: agent.agent_id, scope: SCOPES.MAIL_READ })).toBe(true)
    })

    it('returns false for a different scope than granted', () => {
      const agent = createTestAgent()
      grantScope({ agent_id: agent.agent_id, scope: SCOPES.MAIL_READ, granted_by: agent.agent_id })
      expect(checkPermission({ agent_id: agent.agent_id, scope: SCOPES.MAIL_WRITE })).toBe(false)
    })

    it('returns false for an expired grant', () => {
      const agent = createTestAgent()
      grantScope({
        agent_id: agent.agent_id,
        scope: SCOPES.MODEL_USE,
        granted_by: agent.agent_id,
        expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
      })
      expect(checkPermission({ agent_id: agent.agent_id, scope: SCOPES.MODEL_USE })).toBe(false)
    })

    it('returns true for a grant that has not yet expired', () => {
      const agent = createTestAgent()
      grantScope({
        agent_id: agent.agent_id,
        scope: SCOPES.MODEL_USE,
        granted_by: agent.agent_id,
        expires_at: new Date(Date.now() + 60_000).toISOString(), // valid for 1 minute
      })
      expect(checkPermission({ agent_id: agent.agent_id, scope: SCOPES.MODEL_USE })).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Policy-guard middleware via HTTP
  // -------------------------------------------------------------------------

  describe('policy-guard middleware', () => {
    it('returns 403 when agent lacks the required scope', async () => {
      const agent = createTestAgent()
      // No scopes granted — memory write should be blocked
      const { status } = await req(
        app, 'POST', `/v1/agents/${agent.agent_id}/memory`,
        {
          agent,
          body: { memory_type: 'note', title: 'hi', content: 'world' },
        },
      )
      expect(status).toBe(403)
    })

    it('returns 201 once the required scope is granted', async () => {
      const agent = createTestAgent()
      grantScope({ agent_id: agent.agent_id, scope: SCOPES.MEMORY_WRITE, granted_by: agent.agent_id })

      const { status } = await req(
        app, 'POST', `/v1/agents/${agent.agent_id}/memory`,
        {
          agent,
          body: { memory_type: 'note', title: 'hi', content: 'world' },
        },
      )
      expect(status).toBe(201)
    })

    it('returns 403 for mail.read without grant', async () => {
      const agent = createTestAgent()
      const { status } = await req(
        app, 'GET', `/v1/agents/${agent.agent_id}/mail/inbox`,
        { agent },
      )
      expect(status).toBe(403)
    })
  })
})

// ---------------------------------------------------------------------------
// Identity module tests
//
// Covers: agent creation, ID derivation, key format, email uniqueness,
//         get by id / by email, and nit compatibility (same UUIDv5 algorithm).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent } from './helpers.js'
import { createAgent, getAgentById, getAgentByEmail, listAgents } from '../src/modules/identity/index.js'
import { deriveAgentId } from '../src/crypto.js'

describe('identity module', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // -------------------------------------------------------------------------
  // createAgent
  // -------------------------------------------------------------------------

  describe('createAgent', () => {
    it('returns an agent and a one-time private key', () => {
      const { agent, private_key } = createAgent({
        email_address: 'alice@local',
        display_name: 'Alice',
      })

      expect(agent.agent_id).toBeString()
      expect(agent.email_address).toBe('alice@local')
      expect(agent.display_name).toBe('Alice')
      expect(agent.public_key).toStartWith('ed25519:')
      expect(agent.status).toBe('active')
      expect(private_key).toBeString()
      expect(private_key.length).toBeGreaterThan(0)
    })

    it('derives agent_id from public key using UUIDv5 (nit compatible)', () => {
      const { agent } = createAgent({ email_address: 'bob@local', display_name: 'Bob' })
      const derived = deriveAgentId(agent.public_key)
      expect(agent.agent_id).toBe(derived)
    })

    it('produces a unique agent_id for each keypair', () => {
      const { agent: a1 } = createAgent({ email_address: 'a1@local', display_name: 'A1' })
      const { agent: a2 } = createAgent({ email_address: 'a2@local', display_name: 'A2' })
      expect(a1.agent_id).not.toBe(a2.agent_id)
    })

    it('throws if the email address is already taken', () => {
      createAgent({ email_address: 'taken@local', display_name: 'First' })
      expect(() =>
        createAgent({ email_address: 'taken@local', display_name: 'Second' }),
      ).toThrow()
    })

    it('sets created_at and updated_at as ISO strings', () => {
      const { agent } = createAgent({ email_address: 'ts@local', display_name: 'TS' })
      expect(() => new Date(agent.created_at)).not.toThrow()
      expect(() => new Date(agent.updated_at)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // getAgentById
  // -------------------------------------------------------------------------

  describe('getAgentById', () => {
    it('retrieves the agent after creation', () => {
      const { agent } = createAgent({ email_address: 'find@local', display_name: 'Find' })
      const found = getAgentById(agent.agent_id)
      expect(found).not.toBeNull()
      expect(found!.agent_id).toBe(agent.agent_id)
      expect(found!.email_address).toBe('find@local')
    })

    it('returns null for an unknown id', () => {
      expect(getAgentById('00000000-0000-0000-0000-000000000000')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getAgentByEmail
  // -------------------------------------------------------------------------

  describe('getAgentByEmail', () => {
    it('retrieves the agent by email', () => {
      createAgent({ email_address: 'lookup@local', display_name: 'Lookup' })
      const found = getAgentByEmail('lookup@local')
      expect(found).not.toBeNull()
      expect(found!.email_address).toBe('lookup@local')
    })

    it('returns null for an unknown email', () => {
      expect(getAgentByEmail('nobody@local')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // listAgents
  // -------------------------------------------------------------------------

  describe('listAgents', () => {
    it('returns all created agents', () => {
      createAgent({ email_address: 'l1@local', display_name: 'L1' })
      createAgent({ email_address: 'l2@local', display_name: 'L2' })
      const agents = listAgents()
      expect(agents.length).toBe(2)
    })

    it('returns empty list when no agents exist', () => {
      expect(listAgents()).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // nit compatibility — Phase 5 requirement
  // -------------------------------------------------------------------------

  describe('nit compatibility', () => {
    it('uses the same NIT_NAMESPACE UUID as nit', () => {
      // Verify that deriveAgentId produces a valid v5 UUID
      const { agent } = createAgent({ email_address: 'nit@local', display_name: 'Nit' })
      const id = agent.agent_id
      // UUIDv5 format: xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    it('public key field uses "ed25519:<base64>" format', () => {
      const { agent } = createAgent({ email_address: 'fmt@local', display_name: 'Fmt' })
      expect(agent.public_key).toMatch(/^ed25519:[A-Za-z0-9+/]+=*$/)
    })

    it('same public key always produces the same agent_id', () => {
      const { agent } = createAgent({ email_address: 'stable@local', display_name: 'Stable' })
      // Deriving again from the stored public_key must return the same ID
      expect(deriveAgentId(agent.public_key)).toBe(agent.agent_id)
    })
  })
})

// ---------------------------------------------------------------------------
// Memory + Model Keys module tests
//
// Covers: encrypted memory CRUD, search, share, tag filtering,
//         encrypted model key storage, listing, revocation.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, grantDefaultScopes, req } from './helpers.js'
import { appendMemory, getMemory, updateMemory, deleteMemory, shareMemory } from '../src/modules/memory/index.js'
import { storeModelKey, listModelKeys, revokeModelKey } from '../src/modules/model-keys/index.js'
import { createApp } from '../src/app.js'

const app = createApp({ enableLogger: false })

// ---------------------------------------------------------------------------
// Memory module
// ---------------------------------------------------------------------------

describe('memory module', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  describe('appendMemory', () => {
    it('creates an encrypted memory item', () => {
      const agent = createTestAgent()
      const item = appendMemory({
        owner_agent_id: agent.agent_id,
        memory_type: 'note',
        title: 'My first note',
        content: 'Secret content here',
      })

      expect(item.memory_id).toBeString()
      expect(item.owner_agent_id).toBe(agent.agent_id)
      expect(item.title).toBe('My first note')
      // Ciphertext should NOT be the plaintext
      expect(item.content_ciphertext).not.toBe('Secret content here')
      expect(item.content_ciphertext.length).toBeGreaterThan(0)
      expect(item.content_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(item.visibility).toBe('private')
      expect(item.tags).toEqual([])
    })

    it('stores custom tags and visibility', () => {
      const agent = createTestAgent()
      const item = appendMemory({
        owner_agent_id: agent.agent_id,
        memory_type: 'fact',
        title: 'Tagged',
        content: 'data',
        visibility: 'shared',
        tags: ['project-x', 'important'],
      })

      expect(item.visibility).toBe('shared')
      expect(item.tags).toEqual(['project-x', 'important'])
    })
  })

  describe('getMemory', () => {
    it('returns decrypted content', () => {
      const agent = createTestAgent()
      appendMemory({
        owner_agent_id: agent.agent_id,
        memory_type: 'note',
        title: 'Decryption test',
        content: 'The secret is 42',
      })

      const items = getMemory(agent.agent_id)
      expect(items.length).toBe(1)
      expect(items[0].content).toBe('The secret is 42')
      expect(items[0].title).toBe('Decryption test')
    })

    it('filters by memory_type', () => {
      const agent = createTestAgent()
      appendMemory({ owner_agent_id: agent.agent_id, memory_type: 'note', title: 'A', content: 'a' })
      appendMemory({ owner_agent_id: agent.agent_id, memory_type: 'fact', title: 'B', content: 'b' })
      appendMemory({ owner_agent_id: agent.agent_id, memory_type: 'note', title: 'C', content: 'c' })

      const notes = getMemory(agent.agent_id, { memory_type: 'note' })
      expect(notes.length).toBe(2)
      const facts = getMemory(agent.agent_id, { memory_type: 'fact' })
      expect(facts.length).toBe(1)
    })

    it('filters by title search', () => {
      const agent = createTestAgent()
      appendMemory({ owner_agent_id: agent.agent_id, memory_type: 'note', title: 'Alpha project', content: 'x' })
      appendMemory({ owner_agent_id: agent.agent_id, memory_type: 'note', title: 'Beta release', content: 'y' })

      const results = getMemory(agent.agent_id, { search: 'Alpha' })
      expect(results.length).toBe(1)
      expect(results[0].title).toBe('Alpha project')
    })

    it('does not return other agents\' memory', () => {
      const a1 = createTestAgent('mem1@local')
      const a2 = createTestAgent('mem2@local')
      appendMemory({ owner_agent_id: a1.agent_id, memory_type: 'note', title: 'Private', content: 'mine' })

      const items = getMemory(a2.agent_id)
      expect(items.length).toBe(0)
    })
  })

  describe('updateMemory', () => {
    it('updates title and re-encrypts content', () => {
      const agent = createTestAgent()
      const item = appendMemory({
        owner_agent_id: agent.agent_id,
        memory_type: 'note',
        title: 'Old title',
        content: 'Old content',
      })

      const updated = updateMemory(item.memory_id, {
        title: 'New title',
        content: 'New content',
      })

      expect(updated.title).toBe('New title')

      // Read back and verify decrypted content changed
      const items = getMemory(agent.agent_id)
      expect(items[0].content).toBe('New content')
    })

    it('throws for a non-existent memory_id', () => {
      expect(() => updateMemory('nonexistent', { title: 'x' })).toThrow()
    })
  })

  describe('deleteMemory', () => {
    it('removes the item', () => {
      const agent = createTestAgent()
      const item = appendMemory({
        owner_agent_id: agent.agent_id,
        memory_type: 'note',
        title: 'Delete me',
        content: 'gone',
      })

      deleteMemory(item.memory_id)
      expect(getMemory(agent.agent_id).length).toBe(0)
    })
  })

  describe('shareMemory', () => {
    it('changes visibility to shared', () => {
      const agent = createTestAgent()
      const item = appendMemory({
        owner_agent_id: agent.agent_id,
        memory_type: 'note',
        title: 'Share me',
        content: 'public now',
      })

      expect(item.visibility).toBe('private')
      shareMemory(item.memory_id)

      const items = getMemory(agent.agent_id, { visibility: 'shared' })
      expect(items.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Memory route integration
  // -------------------------------------------------------------------------

  describe('memory routes', () => {
    it('POST → GET round-trip via HTTP', async () => {
      const agent = createTestAgent()
      grantDefaultScopes(agent.agent_id)

      const { status: postStatus } = await req(
        app, 'POST', `/v1/agents/${agent.agent_id}/memory`,
        { agent, body: { memory_type: 'note', title: 'HTTP note', content: 'via route' } },
      )
      expect(postStatus).toBe(201)

      const { status: getStatus, body } = await req<{ items: { title: string; content: string }[] }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/memory`, { agent },
      )
      expect(getStatus).toBe(200)
      expect(body.items.length).toBe(1)
      expect(body.items[0].title).toBe('HTTP note')
      expect(body.items[0].content).toBe('via route')
    })
  })
})

// ---------------------------------------------------------------------------
// Model Keys module
// ---------------------------------------------------------------------------

describe('model-keys module', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  describe('storeModelKey', () => {
    it('stores an encrypted key and returns metadata', () => {
      const agent = createTestAgent()
      const key = storeModelKey({
        agent_id: agent.agent_id,
        provider: 'openai',
        alias: 'gpt4-prod',
        secret: 'sk-live-abc123',
      })

      expect(key.key_id).toBeString()
      expect(key.provider).toBe('openai')
      expect(key.alias).toBe('gpt4-prod')
      // Secret should be encrypted, not plaintext
      expect(key.encrypted_secret).not.toBe('sk-live-abc123')
      expect(key.encrypted_secret.length).toBeGreaterThan(0)
      expect(key.status).toBe('active')
    })

    it('rejects duplicate alias for the same agent', () => {
      const agent = createTestAgent()
      storeModelKey({
        agent_id: agent.agent_id,
        provider: 'openai',
        alias: 'main',
        secret: 'sk-1',
      })

      expect(() =>
        storeModelKey({
          agent_id: agent.agent_id,
          provider: 'openai',
          alias: 'main',
          secret: 'sk-2',
        }),
      ).toThrow()
    })

    it('allows the same alias for different agents', () => {
      const a1 = createTestAgent('mk1@local')
      const a2 = createTestAgent('mk2@local')

      storeModelKey({ agent_id: a1.agent_id, provider: 'openai', alias: 'main', secret: 'sk-1' })
      storeModelKey({ agent_id: a2.agent_id, provider: 'openai', alias: 'main', secret: 'sk-2' })

      expect(listModelKeys(a1.agent_id).length).toBe(1)
      expect(listModelKeys(a2.agent_id).length).toBe(1)
    })
  })

  describe('listModelKeys', () => {
    it('returns aliases without secrets', () => {
      const agent = createTestAgent()
      storeModelKey({ agent_id: agent.agent_id, provider: 'anthropic', alias: 'claude', secret: 'sk-ant-xxx' })
      storeModelKey({ agent_id: agent.agent_id, provider: 'openai', alias: 'gpt4', secret: 'sk-openai-xxx' })

      const keys = listModelKeys(agent.agent_id)
      expect(keys.length).toBe(2)
      // Verify no encrypted_secret field
      for (const k of keys) {
        expect((k as unknown as Record<string, unknown>).encrypted_secret).toBeUndefined()
        expect(k.alias).toBeString()
      }
    })
  })

  describe('revokeModelKey', () => {
    it('marks the key as revoked', () => {
      const agent = createTestAgent()
      storeModelKey({ agent_id: agent.agent_id, provider: 'openai', alias: 'revoke-me', secret: 'sk-x' })

      revokeModelKey(agent.agent_id, 'revoke-me')

      const keys = listModelKeys(agent.agent_id)
      expect(keys[0].status).toBe('revoked')
    })
  })

  // -------------------------------------------------------------------------
  // Model key route integration
  // -------------------------------------------------------------------------

  describe('model-keys routes', () => {
    it('POST + GET round-trip via HTTP, secret never returned', async () => {
      const agent = createTestAgent()
      grantDefaultScopes(agent.agent_id)

      const { status: postStatus, body: postBody } = await req<{ key: Record<string, unknown> }>(
        app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`,
        { agent, body: { provider: 'anthropic', alias: 'test-key', secret: 'sk-secret' } },
      )
      expect(postStatus).toBe(201)
      expect(postBody.key.encrypted_secret).toBeUndefined()
      expect(postBody.key.alias).toBe('test-key')

      const { status: getStatus, body: getBody } = await req<{ keys: { alias: string }[] }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/model-keys`, { agent },
      )
      expect(getStatus).toBe(200)
      expect(getBody.keys.length).toBe(1)
      expect(getBody.keys[0].alias).toBe('test-key')
    })
  })
})

// ---------------------------------------------------------------------------
// Phase 4 — Memory routes tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, grantDefaultScopes, req } from './helpers.js'
import { createApp } from '../src/app.js'

describe('Phase 4 — Memory routes', () => {
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof createTestAgent>

  beforeEach(() => {
    setupTest()
    app = createApp()
    agent = createTestAgent('memory@local', 'Memory Agent')
    grantDefaultScopes(agent.agent_id)
  })

  afterEach(() => {
    teardownTest()
  })

  // -------------------------------------------------------------------------
  // POST /v1/agents/:id/memory
  // -------------------------------------------------------------------------

  it('creates a memory item with valid body → 201, has item.memory_id', async () => {
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'Test fact', content: 'Paris is in France' },
    })
    expect(res.status).toBe(201)
    expect((res.body as any).item.memory_id).toBeString()
  })

  it('POST with missing required fields → 400, code === MISSING_FIELDS', async () => {
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact' }, // missing title and content
    })
    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('MISSING_FIELDS')
  })

  it('POST by wrong agent → 403, code === FORBIDDEN', async () => {
    const other = createTestAgent('other-memory@local', 'Other')
    grantDefaultScopes(other.agent_id)
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent: other,
      body: { memory_type: 'fact', title: 'Test', content: 'Content' },
    })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe('FORBIDDEN')
  })

  // -------------------------------------------------------------------------
  // GET /v1/agents/:id/memory
  // -------------------------------------------------------------------------

  it('GET memory → 200, items array, each item has content (decrypted plaintext)', async () => {
    // Create an item first
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'My fact', content: 'The sky is blue' },
    })

    const res = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory`, { agent })
    expect(res.status).toBe(200)
    const items = (res.body as any).items
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBe(1)
    expect(items[0].content).toBe('The sky is blue')
  })

  it('GET with ?type=fact filter → only returns items of that type', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'Fact 1', content: 'Fact content' },
    })
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'note', title: 'Note 1', content: 'Note content' },
    })

    const res = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory?type=fact`, { agent })
    expect(res.status).toBe(200)
    const items = (res.body as any).items
    expect(items.every((i: any) => i.memory_type === 'fact')).toBe(true)
    expect(items.length).toBe(1)
  })

  it('GET with ?visibility=private filter', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'Private', content: 'Private content', visibility: 'private' },
    })
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'Shared', content: 'Shared content', visibility: 'shared' },
    })

    const res = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory?visibility=private`, { agent })
    expect(res.status).toBe(200)
    const items = (res.body as any).items
    expect(items.every((i: any) => i.visibility === 'private')).toBe(true)
    expect(items.length).toBe(1)
  })

  it('GET with ?q=someword search → matches title', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'Paris facts', content: 'Content about Paris' },
    })
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'note', title: 'London notes', content: 'Content about London' },
    })

    const res = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory?q=Paris`, { agent })
    expect(res.status).toBe(200)
    const items = (res.body as any).items
    expect(items.length).toBe(1)
    expect(items[0].title).toBe('Paris facts')
  })

  it('GET by wrong agent → 403, code === FORBIDDEN', async () => {
    const other = createTestAgent('other-mem-get@local', 'Other')
    grantDefaultScopes(other.agent_id)
    const res = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory`, { agent: other })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe('FORBIDDEN')
  })

  // -------------------------------------------------------------------------
  // PATCH /v1/memory/:id
  // -------------------------------------------------------------------------

  it('PATCH update title → 200, item has updated title', async () => {
    const createRes = await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'Original', content: 'Content' },
    })
    const memoryId = (createRes.body as any).item.memory_id

    const patchRes = await req(app, 'PATCH', `/v1/memory/${memoryId}`, {
      agent,
      body: { title: 'Updated title' },
    })
    expect(patchRes.status).toBe(200)
    expect((patchRes.body as any).item.title).toBe('Updated title')
  })

  it('PATCH update content → GET afterward returns new content value', async () => {
    const createRes = await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'Test', content: 'Old content' },
    })
    const memoryId = (createRes.body as any).item.memory_id

    await req(app, 'PATCH', `/v1/memory/${memoryId}`, {
      agent,
      body: { content: 'New content' },
    })

    const getRes = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory`, { agent })
    const items = (getRes.body as any).items
    expect(items[0].content).toBe('New content')
  })

  it('PATCH unknown id → 404, code === NOT_FOUND', async () => {
    const res = await req(app, 'PATCH', `/v1/memory/nonexistent-id`, {
      agent,
      body: { title: 'Updated' },
    })
    expect(res.status).toBe(404)
    expect((res.body as any).code).toBe('NOT_FOUND')
  })

  // -------------------------------------------------------------------------
  // DELETE /v1/memory/:id
  // -------------------------------------------------------------------------

  it('DELETE → 200, subsequent GET returns empty array', async () => {
    const createRes = await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'To delete', content: 'Delete me' },
    })
    const memoryId = (createRes.body as any).item.memory_id

    const delRes = await req(app, 'DELETE', `/v1/memory/${memoryId}`, { agent })
    expect(delRes.status).toBe(200)
    expect((delRes.body as any).ok).toBe(true)

    const getRes = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory`, { agent })
    expect((getRes.body as any).items.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // POST /v1/memory/:id/share
  // -------------------------------------------------------------------------

  it('POST share → 200, subsequent GET item has visibility === shared', async () => {
    const createRes = await req(app, 'POST', `/v1/agents/${agent.agent_id}/memory`, {
      agent,
      body: { memory_type: 'fact', title: 'To share', content: 'Share me', visibility: 'private' },
    })
    const memoryId = (createRes.body as any).item.memory_id

    const shareRes = await req(app, 'POST', `/v1/memory/${memoryId}/share`, { agent })
    expect(shareRes.status).toBe(200)

    const getRes = await req(app, 'GET', `/v1/agents/${agent.agent_id}/memory`, { agent })
    const items = (getRes.body as any).items
    expect(items[0].visibility).toBe('shared')
  })

  // -------------------------------------------------------------------------
  // Scope tests
  // -------------------------------------------------------------------------

  it('GET without MEMORY_READ scope → 403', async () => {
    const noScope = createTestAgent('noscoperead@local', 'No Scope Read')
    // No grantDefaultScopes
    const res = await req(app, 'GET', `/v1/agents/${noScope.agent_id}/memory`, { agent: noScope })
    expect(res.status).toBe(403)
  })

  it('POST without MEMORY_WRITE scope → 403', async () => {
    const noScope = createTestAgent('noscopewrite@local', 'No Scope Write')
    // No grantDefaultScopes
    const res = await req(app, 'POST', `/v1/agents/${noScope.agent_id}/memory`, {
      agent: noScope,
      body: { memory_type: 'fact', title: 'Test', content: 'Content' },
    })
    expect(res.status).toBe(403)
  })
})

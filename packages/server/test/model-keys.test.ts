// ---------------------------------------------------------------------------
// Phase 4 — Model Keys routes tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, grantDefaultScopes, req } from './helpers.js'
import { createApp } from '../src/app.js'

describe('Phase 4 — Model Keys routes', () => {
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof createTestAgent>
  let origFetch: typeof globalThis.fetch

  beforeEach(() => {
    setupTest()
    app = createApp()
    agent = createTestAgent('modelkeys@local', 'Model Keys Agent')
    grantDefaultScopes(agent.agent_id)
    origFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    teardownTest()
  })

  // -------------------------------------------------------------------------
  // POST /v1/agents/:id/model-keys
  // -------------------------------------------------------------------------

  it('stores a model key → 201, has key.key_id, key.provider, key.alias', async () => {
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'my-key', secret: 'sk-test' },
    })
    expect(res.status).toBe(201)
    const key = (res.body as any).key
    expect(key.key_id).toBeString()
    expect(key.provider).toBe('openai')
    expect(key.alias).toBe('my-key')
  })

  it('response must NOT contain encrypted_secret field', async () => {
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'safe-key', secret: 'sk-secret' },
    })
    expect(res.status).toBe(201)
    expect((res.body as any).key.encrypted_secret).toBeUndefined()
  })

  it('POST with missing fields → 400, code === MISSING_FIELDS', async () => {
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai' }, // missing alias and secret
    })
    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('MISSING_FIELDS')
  })

  it('POST by wrong agent → 403, code === FORBIDDEN', async () => {
    const other = createTestAgent('other-mk@local', 'Other')
    grantDefaultScopes(other.agent_id)
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent: other,
      body: { provider: 'openai', alias: 'my-key', secret: 'sk-test' },
    })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe('FORBIDDEN')
  })

  it('POST same alias twice → 409, code === DUPLICATE', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'dup-key', secret: 'sk-test' },
    })
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'dup-key', secret: 'sk-test2' },
    })
    expect(res.status).toBe(409)
    expect((res.body as any).code).toBe('DUPLICATE')
  })

  // -------------------------------------------------------------------------
  // GET /v1/agents/:id/model-keys
  // -------------------------------------------------------------------------

  it('GET model-keys → 200, keys array', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'list-key', secret: 'sk-test' },
    })

    const res = await req(app, 'GET', `/v1/agents/${agent.agent_id}/model-keys`, { agent })
    expect(res.status).toBe(200)
    const keys = (res.body as any).keys
    expect(Array.isArray(keys)).toBe(true)
    expect(keys.length).toBe(1)
  })

  // -------------------------------------------------------------------------
  // DELETE /v1/agents/:id/model-keys/:alias
  // -------------------------------------------------------------------------

  it('DELETE → 200, subsequent GET shows status === revoked', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'revoke-key', secret: 'sk-test' },
    })

    const delRes = await req(app, 'DELETE', `/v1/agents/${agent.agent_id}/model-keys/revoke-key`, { agent })
    expect(delRes.status).toBe(200)
    expect((delRes.body as any).ok).toBe(true)

    // List to verify status changed
    const listRes = await req(app, 'GET', `/v1/agents/${agent.agent_id}/model-keys`, { agent })
    const keys = (listRes.body as any).keys
    expect(keys[0].status).toBe('revoked')
  })

  it('DELETE by wrong agent → 403, code === FORBIDDEN', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'del-forbidden', secret: 'sk-test' },
    })

    const other = createTestAgent('other-del@local', 'Other')
    grantDefaultScopes(other.agent_id)
    const res = await req(app, 'DELETE', `/v1/agents/${agent.agent_id}/model-keys/del-forbidden`, { agent: other })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe('FORBIDDEN')
  })

  // -------------------------------------------------------------------------
  // POST /:alias/invoke
  // -------------------------------------------------------------------------

  it('invoke with mocked fetch returning 200 → 200', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'invoke-key', secret: 'sk-test' },
    })

    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }) as any

    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys/invoke-key/invoke`, {
      agent,
      body: { model: 'gpt-4', messages: [] },
    })
    expect(res.status).toBe(200)
  })

  it('invoke with non-existent alias → 400, code === NOT_FOUND', async () => {
    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys/nonexistent/invoke`, {
      agent,
      body: { model: 'gpt-4', messages: [] },
    })
    expect(res.status).toBe(400)
    expect((res.body as any).code).toBe('NOT_FOUND')
  })

  it('invoke with mocked fetch returning 500 → 502', async () => {
    await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys`, {
      agent,
      body: { provider: 'openai', alias: 'fail-invoke', secret: 'sk-test' },
    })

    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 }) as any

    const res = await req(app, 'POST', `/v1/agents/${agent.agent_id}/model-keys/fail-invoke/invoke`, {
      agent,
      body: { model: 'gpt-4', messages: [] },
    })
    expect(res.status).toBe(502)
  })

  it('invoke without MODEL_USE scope → 403', async () => {
    const noScope = createTestAgent('nomodelscope@local', 'No Model Scope')
    // No grantDefaultScopes — no MODEL_USE scope

    const res = await req(app, 'POST', `/v1/agents/${noScope.agent_id}/model-keys/some-key/invoke`, {
      agent: noScope,
      body: { model: 'gpt-4', messages: [] },
    })
    expect(res.status).toBe(403)
  })
})

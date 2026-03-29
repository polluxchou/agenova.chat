// ---------------------------------------------------------------------------
// Model Key Broker module
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { encrypt, decrypt, randomUuid } from '../../crypto.js'
import type { ModelKey, ModelProvider } from '../../types.js'

const PURPOSE = 'model-keys'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface StoreModelKeyInput {
  agent_id: string
  provider: ModelProvider
  alias: string
  secret: string              // raw API key — encrypted before storage
}

export function storeModelKey(input: StoreModelKeyInput): ModelKey {
  const existing = dbGet<ModelKey>(
    'SELECT * FROM model_keys WHERE agent_id = ? AND alias = ?',
    input.agent_id, input.alias,
  )
  if (existing) throw new Error(`Model key with alias "${input.alias}" already exists for this agent`)

  const now = new Date().toISOString()
  const key: ModelKey = {
    key_id: randomUuid(),
    agent_id: input.agent_id,
    provider: input.provider,
    alias: input.alias,
    encrypted_secret: encrypt(input.secret, PURPOSE, input.agent_id),
    status: 'active',
    created_at: now,
  }

  dbRun(
    `INSERT INTO model_keys (key_id, agent_id, provider, alias, encrypted_secret, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    key.key_id, key.agent_id, key.provider, key.alias, key.encrypted_secret, key.status, key.created_at,
  )

  return key
}

// ---------------------------------------------------------------------------
// List (aliases only — never returns secrets)
// ---------------------------------------------------------------------------

export interface ModelKeyPublic {
  key_id: string
  agent_id: string
  provider: ModelProvider
  alias: string
  status: string
  created_at: string
  last_used_at?: string
}

export function listModelKeys(agent_id: string): ModelKeyPublic[] {
  return dbAll<ModelKeyPublic>(
    `SELECT key_id, agent_id, provider, alias, status, created_at, last_used_at
     FROM model_keys WHERE agent_id = ? ORDER BY created_at DESC`,
    agent_id,
  )
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

export function revokeModelKey(agent_id: string, alias: string): void {
  dbRun(
    `UPDATE model_keys SET status = 'revoked' WHERE agent_id = ? AND alias = ?`,
    agent_id, alias,
  )
}

// ---------------------------------------------------------------------------
// Invoke (proxy model call)
// ---------------------------------------------------------------------------

export interface InvokeModelInput {
  agent_id: string
  alias: string
  payload: unknown
}

export interface InvokeModelResult {
  ok: boolean
  data?: unknown
  error?: string
}

export async function invokeModel(input: InvokeModelInput): Promise<InvokeModelResult> {
  const row = dbGet<ModelKey>(
    `SELECT * FROM model_keys WHERE agent_id = ? AND alias = ? AND status = 'active'`,
    input.agent_id, input.alias,
  )
  if (!row) throw new Error(`Model key "${input.alias}" not found or revoked`)

  const secret = decrypt(row.encrypted_secret, PURPOSE, input.agent_id)

  // Update last_used_at
  dbRun(
    `UPDATE model_keys SET last_used_at = ? WHERE key_id = ?`,
    new Date().toISOString(), row.key_id,
  )

  const endpoint = resolveEndpoint(row.provider)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
  }

  // Anthropic requires an extra version header
  if (row.provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.payload),
    })
    const data = await res.json()
    return { ok: res.ok, data }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveEndpoint(provider: ModelProvider): string {
  switch (provider) {
    case 'openai':     return 'https://api.openai.com/v1/chat/completions'
    case 'anthropic':  return 'https://api.anthropic.com/v1/messages'
    case 'google':     return 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
    default:           throw new Error(`Unknown provider: ${provider}`)
  }
}

// ---------------------------------------------------------------------------
// Memory Ledger module
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { encrypt, decrypt, sha256, randomUuid } from '../../crypto.js'
import type { MemoryItem, MemoryType, Visibility } from '../../types.js'

const PURPOSE = 'memory'

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

export interface AppendMemoryInput {
  owner_agent_id: string
  memory_type: MemoryType
  title: string
  content: string             // plaintext — encrypted before storage
  visibility?: Visibility
  tags?: string[]
}

export function appendMemory(input: AppendMemoryInput): MemoryItem {
  const now = new Date().toISOString()
  const memory_id = randomUuid()
  const content_hash = sha256(input.content)
  const content_ciphertext = encrypt(input.content, PURPOSE, input.owner_agent_id)

  const item: MemoryItem = {
    memory_id,
    owner_agent_id: input.owner_agent_id,
    memory_type: input.memory_type,
    title: input.title,
    content_ciphertext,
    content_hash,
    visibility: input.visibility ?? 'private',
    tags: input.tags ?? [],
    created_at: now,
    updated_at: now,
  }

  dbRun(
    `INSERT INTO memory_items (memory_id, owner_agent_id, memory_type, title, content_ciphertext, content_hash, visibility, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.memory_id,
    item.owner_agent_id,
    item.memory_type,
    item.title,
    item.content_ciphertext,
    item.content_hash,
    item.visibility,
    JSON.stringify(item.tags),
    item.created_at,
    item.updated_at,
  )

  return item
}

// ---------------------------------------------------------------------------
// Read (with decryption)
// ---------------------------------------------------------------------------

export interface QueryMemoryOptions {
  memory_type?: MemoryType
  visibility?: Visibility
  tags?: string[]
  search?: string
  limit?: number
  offset?: number
}

export interface MemoryItemWithContent extends MemoryItem {
  content: string             // decrypted plaintext
}

export function getMemory(agent_id: string, options: QueryMemoryOptions = {}): MemoryItemWithContent[] {
  let sql = `SELECT * FROM memory_items WHERE owner_agent_id = ?`
  const params: unknown[] = [agent_id]

  if (options.memory_type) {
    sql += ` AND memory_type = ?`
    params.push(options.memory_type)
  }
  if (options.visibility) {
    sql += ` AND visibility = ?`
    params.push(options.visibility)
  }
  if (options.search) {
    sql += ` AND title LIKE ? COLLATE NOCASE`
    params.push(`%${options.search}%`)
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
  params.push(options.limit ?? 20, options.offset ?? 0)

  const rows = dbAll<Record<string, unknown>>(sql, ...params)
  return rows.map(row => {
    const item = rowToMemoryItem(row)
    const content = decrypt(item.content_ciphertext, PURPOSE, agent_id)
    return { ...item, content }
  })
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateMemoryInput {
  title?: string
  content?: string
  visibility?: Visibility
  tags?: string[]
}

export function updateMemory(memory_id: string, patch: UpdateMemoryInput): MemoryItem {
  const row = dbGet<Record<string, unknown>>('SELECT * FROM memory_items WHERE memory_id = ?', memory_id)
  if (!row) throw new Error(`Memory item ${memory_id} not found`)

  const existing = rowToMemoryItem(row)
  const now = new Date().toISOString()

  const title = patch.title ?? existing.title
  const visibility = patch.visibility ?? existing.visibility
  const tags = patch.tags ?? existing.tags

  let content_ciphertext = existing.content_ciphertext
  let content_hash = existing.content_hash

  if (patch.content !== undefined) {
    content_hash = sha256(patch.content)
    content_ciphertext = encrypt(patch.content, PURPOSE, existing.owner_agent_id)
  }

  dbRun(
    `UPDATE memory_items SET title = ?, content_ciphertext = ?, content_hash = ?, visibility = ?, tags = ?, updated_at = ? WHERE memory_id = ?`,
    title, content_ciphertext, content_hash, visibility, JSON.stringify(tags), now, memory_id,
  )

  return { ...existing, title, content_ciphertext, content_hash, visibility, tags, updated_at: now }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteMemory(memory_id: string): void {
  dbRun('DELETE FROM memory_items WHERE memory_id = ?', memory_id)
}

// ---------------------------------------------------------------------------
// Share (update visibility to 'shared')
// ---------------------------------------------------------------------------

export function shareMemory(memory_id: string): void {
  dbRun(
    `UPDATE memory_items SET visibility = 'shared', updated_at = ? WHERE memory_id = ?`,
    new Date().toISOString(),
    memory_id,
  )
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToMemoryItem(row: Record<string, unknown>): MemoryItem {
  return {
    memory_id: row.memory_id as string,
    owner_agent_id: row.owner_agent_id as string,
    memory_type: row.memory_type as MemoryType,
    title: row.title as string,
    content_ciphertext: row.content_ciphertext as string,
    content_hash: row.content_hash as string,
    visibility: row.visibility as Visibility,
    tags: safeJsonParse(row.tags as string, []),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

function safeJsonParse<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

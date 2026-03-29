// ---------------------------------------------------------------------------
// Agenova v1 — SQLite client
// Uses bun:sqlite (zero-dep, WAL, synchronous for simplicity)
// ---------------------------------------------------------------------------

import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { SCHEMA } from './schema.js'

let _db: Database | null = null

export function getDb(): Database {
  if (_db) return _db

  const dir = join(homedir(), '.agenova')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const dbPath = process.env.AGENOVA_DB_PATH ?? join(dir, 'agenova.db')
  _db = new Database(dbPath)
  _db.exec(SCHEMA)

  return _db
}

// ---------------------------------------------------------------------------
// Test reset hook — closes and clears the cached DB instance.
// Call this in afterEach/afterAll to ensure test isolation.
// ---------------------------------------------------------------------------

export function _resetDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

/**
 * Create an isolated in-memory database for a single test.
 * The returned database is fully initialised with the schema.
 */
export function _createTestDb(): Database {
  _resetDb()
  _db = new Database(':memory:')
  _db.exec(SCHEMA)
  return _db
}

// ---------------------------------------------------------------------------
// Typed query helpers
// ---------------------------------------------------------------------------

export function dbGet<T>(sql: string, ...params: unknown[]): T | null {
  return getDb().prepare(sql).get(...(params as Parameters<typeof getDb>)) as T | null
}

export function dbAll<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...(params as Parameters<typeof getDb>)) as T[]
}

export function dbRun(sql: string, ...params: unknown[]): void {
  getDb().prepare(sql).run(...(params as Parameters<typeof getDb>))
}

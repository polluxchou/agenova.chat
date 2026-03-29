// ---------------------------------------------------------------------------
// DB singleton — mirrors the local server pattern
// ---------------------------------------------------------------------------

import { Database } from 'bun:sqlite'
import { SCHEMA } from './schema.js'

let _db: Database | null = null

export function getDb(): Database {
  if (!_db) {
    const dbPath = process.env.AGENOVA_HOSTED_DB_PATH ?? './hosted.db'
    _db = new Database(dbPath)
    _db.exec(SCHEMA)
  }
  return _db
}

export function _resetDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function _createTestDb(): Database {
  _db = new Database(':memory:')
  _db.exec(SCHEMA)
  return _db
}

// ---------------------------------------------------------------------------
// Typed query helpers
// ---------------------------------------------------------------------------

export function dbGet<T>(sql: string, ...params: unknown[]): T | null {
  const stmt = getDb().prepare(sql)
  return (stmt.get(...params) as T) ?? null
}

export function dbAll<T>(sql: string, ...params: unknown[]): T[] {
  const stmt = getDb().prepare(sql)
  return stmt.all(...params) as T[]
}

export function dbRun(sql: string, ...params: unknown[]): void {
  const stmt = getDb().prepare(sql)
  stmt.run(...params)
}

#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Token provisioning CLI
//
// Generates a secure API token, stores its SHA-256 hash in the database,
// and prints the raw token once (to be copied to the local server's env).
//
// Usage:
//   bun run scripts/provision-token.ts [label]
//   bun run scripts/provision-token.ts "production-server-1"
//
// Environment:
//   AGENOVA_HOSTED_DB_PATH — path to the hosted SQLite DB (default: ./hosted.db)
//
// The raw token is printed ONCE to stdout and is never stored.
// Store it in the local server's AGENOVA_API_TOKEN env var.
// ---------------------------------------------------------------------------

import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'

const SCHEMA_TOKENS = `
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash  TEXT PRIMARY KEY,
  label       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'revoked')),
  created_at  TEXT NOT NULL
);
`

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex')
}

function generateToken(): string {
  // 32 random bytes → 64-char hex string, prefixed for readability
  return 'agt_' + randomBytes(32).toString('hex')
}

function main() {
  const label = process.argv[2] ?? 'provisioned'
  const dbPath = process.env.AGENOVA_HOSTED_DB_PATH ?? './hosted.db'

  console.error(`[provision] Using DB: ${dbPath}`)
  console.error(`[provision] Label:    ${label}`)

  const db = new Database(dbPath)
  db.exec(SCHEMA_TOKENS)

  const token = generateToken()
  const hash  = sha256(token)
  const now   = new Date().toISOString()

  db.prepare(
    `INSERT INTO api_tokens (token_hash, label, status, created_at) VALUES (?, ?, 'active', ?)`,
  ).run(hash, label, now)

  db.close()

  console.error(`[provision] Token stored (SHA-256: ${hash.slice(0, 16)}...)`)
  console.error(`[provision] Copy the token below into your local server's AGENOVA_API_TOKEN env var:`)
  console.error(``)

  // Raw token goes to stdout so it can be piped/captured cleanly
  // All informational output goes to stderr
  console.log(token)
}

main()

// ---------------------------------------------------------------------------
// Hosted API — Maintenance / cleanup tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest } from './helpers.js'
import { dbRun, dbGet, dbAll } from '../src/db/client.js'
import { cleanupExpiredChallenges, _resetMaintenanceLoop } from '../src/maintenance.js'

function insertChallenge(opts: {
  claim_id: string
  handle: string
  status?: string
  expires_at: string
  created_at?: string
}): void {
  const now = opts.created_at ?? new Date().toISOString()
  dbRun(
    `INSERT INTO claim_challenges (claim_id, handle, agent_id, public_key, challenge, status, expires_at, created_at)
     VALUES (?, ?, 'agent-1', 'pk', 'challenge-text', ?, ?, ?)`,
    opts.claim_id,
    opts.handle,
    opts.status ?? 'pending',
    opts.expires_at,
    now,
  )
}

describe('Hosted API — Maintenance: cleanupExpiredChallenges()', () => {
  beforeEach(() => setupTest())
  afterEach(() => {
    _resetMaintenanceLoop()
    teardownTest()
  })

  it('marks pending challenges whose expires_at is in the past', () => {
    const past = new Date(Date.now() - 10_000).toISOString()   // 10 s ago
    const future = new Date(Date.now() + 60_000).toISOString() // 1 min from now

    insertChallenge({ claim_id: 'c1', handle: 'alice', expires_at: past })
    insertChallenge({ claim_id: 'c2', handle: 'bob',   expires_at: future })

    cleanupExpiredChallenges()

    const c1 = dbGet<{ status: string }>(`SELECT status FROM claim_challenges WHERE claim_id = 'c1'`)
    const c2 = dbGet<{ status: string }>(`SELECT status FROM claim_challenges WHERE claim_id = 'c2'`)

    expect(c1?.status).toBe('expired')
    expect(c2?.status).toBe('pending')  // not yet expired
  })

  it('does not touch already-verified challenges', () => {
    const past = new Date(Date.now() - 10_000).toISOString()

    insertChallenge({ claim_id: 'cv', handle: 'carol', expires_at: past, status: 'verified' })

    cleanupExpiredChallenges()

    const cv = dbGet<{ status: string }>(`SELECT status FROM claim_challenges WHERE claim_id = 'cv'`)
    expect(cv?.status).toBe('verified')  // untouched
  })

  it('hard-deletes rows older than 24 hours', () => {
    const old_date = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()  // 25 h ago
    const recent   = new Date(Date.now() - 30_000).toISOString()                // 30 s ago

    insertChallenge({ claim_id: 'old', handle: 'dave',  expires_at: old_date, created_at: old_date })
    insertChallenge({ claim_id: 'new', handle: 'eve',   expires_at: recent,   created_at: recent  })

    cleanupExpiredChallenges()

    const rows = dbAll<{ claim_id: string }>(`SELECT claim_id FROM claim_challenges`)
    const ids = rows.map(r => r.claim_id)

    expect(ids).not.toContain('old')
    expect(ids).toContain('new')
  })

  it('is idempotent — running twice does not error', () => {
    const past = new Date(Date.now() - 10_000).toISOString()
    insertChallenge({ claim_id: 'idem', handle: 'frank', expires_at: past })

    expect(() => {
      cleanupExpiredChallenges()
      cleanupExpiredChallenges()
    }).not.toThrow()
  })

  it('returns marked count for expired pending challenges', () => {
    const past = new Date(Date.now() - 10_000).toISOString()
    insertChallenge({ claim_id: 'm1', handle: 'g1', expires_at: past })
    insertChallenge({ claim_id: 'm2', handle: 'g2', expires_at: past })

    const { marked } = cleanupExpiredChallenges()
    expect(marked).toBeGreaterThanOrEqual(2)
  })
})

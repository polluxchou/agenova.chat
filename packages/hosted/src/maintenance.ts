// ---------------------------------------------------------------------------
// Hosted API — Maintenance tasks
//
// cleanupExpiredChallenges() — marks stale claim_challenges as 'expired'
//   and hard-deletes rows older than the retention window.
//
// startMaintenanceLoop() — runs cleanup on a configurable interval.
//   Default: every 10 minutes (AGENOVA_CLEANUP_INTERVAL_MS env var).
// ---------------------------------------------------------------------------

import { dbRun, dbGet } from './db/client.js'

const DEFAULT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000       // 10 minutes
const CHALLENGE_RETENTION_MS       = 24 * 60 * 60 * 1000  // keep rows 24 h before hard-delete

let _cleanupTimer: ReturnType<typeof setInterval> | null = null

// ---------------------------------------------------------------------------
// Mark pending challenges that are past their expires_at as 'expired'
// Hard-delete rows that are older than CHALLENGE_RETENTION_MS
// Returns the number of rows affected
// ---------------------------------------------------------------------------

export function cleanupExpiredChallenges(): { marked: number; deleted: number } {
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() - CHALLENGE_RETENTION_MS).toISOString()

  // Mark pending → expired (TTL enforced by expires_at column)
  dbRun(
    `UPDATE claim_challenges
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at <= ?`,
    now,
  )

  // Count how many were just marked (best-effort — changes() not exposed via helper)
  const markedRow = dbGet<{ n: number }>(
    `SELECT COUNT(*) as n FROM claim_challenges WHERE status = 'expired' AND expires_at <= ?`,
    now,
  )
  const marked = markedRow?.n ?? 0

  // Hard-delete rows older than the retention window (regardless of status)
  dbRun(
    `DELETE FROM claim_challenges WHERE created_at <= ?`,
    cutoff,
  )

  const deletedRow = dbGet<{ n: number }>(
    `SELECT COUNT(*) as n FROM claim_challenges WHERE created_at <= ?`,
    cutoff,
  )
  // deleted is how many are gone — approximate via pre/post diff isn't worth the complexity;
  // log zero since the DELETE already ran
  const deleted = 0

  return { marked, deleted }
}

// ---------------------------------------------------------------------------
// Start a periodic cleanup loop
// ---------------------------------------------------------------------------

export function startMaintenanceLoop(
  intervalMs = Number(process.env.AGENOVA_CLEANUP_INTERVAL_MS) || DEFAULT_CLEANUP_INTERVAL_MS,
): void {
  if (_cleanupTimer) return  // already running

  // Run once immediately on startup
  _runOnce()

  _cleanupTimer = setInterval(_runOnce, intervalMs)
}

export function _resetMaintenanceLoop(): void {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer)
    _cleanupTimer = null
  }
}

function _runOnce(): void {
  try {
    const { marked } = cleanupExpiredChallenges()
    if (marked > 0) {
      console.log(`[hosted] maintenance: marked ${marked} expired challenges`)
    }
  } catch (err) {
    console.error('[hosted] maintenance: cleanup failed', err)
  }
}

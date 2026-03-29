// ---------------------------------------------------------------------------
// Device & LAN Pairing module
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { sha256, randomUuid, randomNumericCode } from '../../crypto.js'
import type { Device, PairingSession } from '../../types.js'

const PAIRING_TTL_MS = 5 * 60 * 1000   // 5 minutes

// ---------------------------------------------------------------------------
// Pairing — start (called by the new device)
// ---------------------------------------------------------------------------

export interface StartPairingInput {
  device_name: string
  device_public_key?: string   // optional per-device Ed25519 key (raw base64)
}

export interface StartPairingResult {
  session_id: string
  pairing_code: string         // 6-digit code shown on host UI
  expires_at: string
}

export function startPairing(input: StartPairingInput): StartPairingResult {
  const session_id = randomUuid()
  const pairing_code = randomNumericCode(6)
  const expires_at = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
  const now = new Date().toISOString()

  dbRun(
    `INSERT INTO pairing_sessions (session_id, pairing_code, device_name, device_public_key, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    session_id,
    pairing_code,
    input.device_name,
    input.device_public_key ?? null,
    expires_at,
    now,
  )

  return { session_id, pairing_code, expires_at }
}

// ---------------------------------------------------------------------------
// Pairing — approve (called by the host)
// ---------------------------------------------------------------------------

export interface ApprovePairingInput {
  pairing_code: string
  agent_id: string
}

export function approvePairing(input: ApprovePairingInput): Device {
  const now = new Date().toISOString()

  const session = dbGet<PairingSession>(
    `SELECT * FROM pairing_sessions WHERE pairing_code = ? AND status = 'pending'`,
    input.pairing_code,
  )

  if (!session) throw new Error('Invalid or already-used pairing code')
  if (new Date(session.expires_at) < new Date()) {
    dbRun(`UPDATE pairing_sessions SET status = 'expired' WHERE session_id = ?`, session.session_id)
    throw new Error('Pairing code has expired')
  }

  const device_id = randomUuid()
  const fingerprint = session.device_public_key
    ? sha256(session.device_public_key)
    : sha256(session.session_id)  // fallback fingerprint

  const device: Device = {
    device_id,
    agent_id: input.agent_id,
    device_name: session.device_name ?? 'unnamed',
    device_fingerprint: fingerprint,
    device_public_key: session.device_public_key,
    status: 'active',
    last_seen_at: now,
    created_at: now,
  }

  dbRun(
    `INSERT INTO devices (device_id, agent_id, device_name, device_fingerprint, device_public_key, status, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    device.device_id,
    device.agent_id,
    device.device_name,
    device.device_fingerprint,
    device.device_public_key ?? null,
    device.last_seen_at,
    device.created_at,
  )

  // Mark session approved and bind agent
  dbRun(
    `UPDATE pairing_sessions SET status = 'approved', agent_id = ? WHERE session_id = ?`,
    input.agent_id, session.session_id,
  )

  return device
}

// ---------------------------------------------------------------------------
// Revoke device
// ---------------------------------------------------------------------------

export function revokeDevice(device_id: string): void {
  dbRun(
    `UPDATE devices SET status = 'revoked' WHERE device_id = ?`,
    device_id,
  )
}

// ---------------------------------------------------------------------------
// List devices for agent
// ---------------------------------------------------------------------------

export function listDevices(agent_id: string): Device[] {
  return dbAll<Device>(
    `SELECT * FROM devices WHERE agent_id = ? ORDER BY created_at DESC`,
    agent_id,
  )
}

export function getDevice(device_id: string): Device | null {
  return dbGet<Device>('SELECT * FROM devices WHERE device_id = ?', device_id)
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export function touchDevice(device_id: string): void {
  dbRun(
    `UPDATE devices SET last_seen_at = ? WHERE device_id = ?`,
    new Date().toISOString(), device_id,
  )
}

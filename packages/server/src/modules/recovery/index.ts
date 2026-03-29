// ---------------------------------------------------------------------------
// Recovery Vault module
// ---------------------------------------------------------------------------

import { dbGet, dbRun } from '../../db/client.js'
import { encryptWithPassphrase, decryptWithPassphrase, randomUuid, randomNumericCode } from '../../crypto.js'
import { getAgentById } from '../identity/index.js'
import type { RecoveryRecord } from '../../types.js'

// ---------------------------------------------------------------------------
// Create recovery pack
// In a real system the caller provides the agent's private key to include in
// the bundle. Here we store a JSON bundle encrypted with a one-time code.
// ---------------------------------------------------------------------------

export interface CreateRecoveryPackInput {
  agent_id: string
  private_key_seed: string   // raw base64 Ed25519 seed to include in bundle
}

export interface CreateRecoveryPackResult {
  recovery_code: string      // one-time 12-digit numeric code shown to user
}

export function createRecoveryPack(input: CreateRecoveryPackInput): CreateRecoveryPackResult {
  const agent = getAgentById(input.agent_id)
  if (!agent) throw new Error(`Agent ${input.agent_id} not found`)

  const recovery_code = randomNumericCode(12)

  const bundle = JSON.stringify({
    agent_id: agent.agent_id,
    email_address: agent.email_address,
    display_name: agent.display_name,
    public_key: agent.public_key,
    private_key_seed: input.private_key_seed,
    created_at: new Date().toISOString(),
  })

  const encrypted_blob = encryptWithPassphrase(bundle, recovery_code)
  const now = new Date().toISOString()

  const existing = dbGet<RecoveryRecord>('SELECT * FROM recovery_records WHERE agent_id = ?', input.agent_id)
  if (existing) {
    dbRun(
      `UPDATE recovery_records SET encrypted_blob = ?, updated_at = ? WHERE agent_id = ?`,
      encrypted_blob, now, input.agent_id,
    )
  } else {
    dbRun(
      `INSERT INTO recovery_records (record_id, agent_id, encrypted_blob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      randomUuid(), input.agent_id, encrypted_blob, now, now,
    )
  }

  return { recovery_code }
}

// ---------------------------------------------------------------------------
// Export encrypted backup (for off-site storage)
// ---------------------------------------------------------------------------

export function exportEncryptedBackup(agent_id: string): string {
  const record = dbGet<RecoveryRecord>('SELECT * FROM recovery_records WHERE agent_id = ?', agent_id)
  if (!record) throw new Error(`No recovery record found for agent ${agent_id}`)
  return record.encrypted_blob
}

// ---------------------------------------------------------------------------
// Restore identity from recovery code
// ---------------------------------------------------------------------------

export interface RestoreIdentityResult {
  agent_id: string
  email_address: string
  display_name: string
  public_key: string
  private_key_seed: string
}

export function restoreIdentity(agent_id: string, recovery_code: string): RestoreIdentityResult {
  const record = dbGet<RecoveryRecord>('SELECT * FROM recovery_records WHERE agent_id = ?', agent_id)
  if (!record) throw new Error(`No recovery record found for agent ${agent_id}`)

  let bundle: RestoreIdentityResult
  try {
    bundle = JSON.parse(decryptWithPassphrase(record.encrypted_blob, recovery_code))
  } catch {
    throw new Error('Invalid recovery code')
  }

  return bundle
}

// ---------------------------------------------------------------------------
// Import backup blob (restore on a fresh node)
// ---------------------------------------------------------------------------

export function importEncryptedBackup(blob: string, recovery_code: string): RestoreIdentityResult {
  let bundle: RestoreIdentityResult
  try {
    bundle = JSON.parse(decryptWithPassphrase(blob, recovery_code))
  } catch {
    throw new Error('Invalid recovery code or corrupted backup')
  }
  return bundle
}

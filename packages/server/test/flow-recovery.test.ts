// ---------------------------------------------------------------------------
// Phase 2 — Recovery vault flow test
//
// Tests the identity backup and restore lifecycle:
//   1. Create an agent
//   2. Create a recovery pack → get a 12-digit code
//   3. Export encrypted backup blob
//   4. Restore identity from the recovery code
//   5. Import from raw backup blob on a fresh node
//   6. Verify restored identity matches the original
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, req } from './helpers.js'
import { createApp } from '../src/app.js'
import { createAgent, getAgentById } from '../src/modules/identity/index.js'
import {
  createRecoveryPack,
  exportEncryptedBackup,
  restoreIdentity,
  importEncryptedBackup,
} from '../src/modules/recovery/index.js'
import { verifySignature, signMessage } from '../src/crypto.js'

const app = createApp({ enableLogger: false })

describe('Phase 2 — Recovery vault flow', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // =========================================================================
  // Module-level tests
  // =========================================================================

  describe('recovery lifecycle (module-level)', () => {
    it('create → export → restore: full round-trip', () => {
      // 1. Create agent
      const result = createAgent({ email_address: 'recover@local', display_name: 'Recover' })
      const { agent, private_key } = result

      // 2. Create recovery pack
      const { recovery_code } = createRecoveryPack({
        agent_id: agent.agent_id,
        private_key_seed: private_key,
      })
      expect(recovery_code).toMatch(/^\d{12}$/)

      // 3. Export the encrypted blob
      const blob = exportEncryptedBackup(agent.agent_id)
      expect(blob).toBeString()
      expect(blob.length).toBeGreaterThan(0)

      // 4. Restore from recovery code
      const restored = restoreIdentity(agent.agent_id, recovery_code)
      expect(restored.agent_id).toBe(agent.agent_id)
      expect(restored.email_address).toBe('recover@local')
      expect(restored.public_key).toBe(agent.public_key)
      expect(restored.private_key_seed).toBe(private_key)
    })

    it('import from raw blob: simulates restoring on a fresh device', () => {
      const result = createAgent({ email_address: 'import@local', display_name: 'Import' })
      const { agent, private_key } = result

      const { recovery_code } = createRecoveryPack({
        agent_id: agent.agent_id,
        private_key_seed: private_key,
      })
      const blob = exportEncryptedBackup(agent.agent_id)

      // Import from the raw blob (like receiving it via file transfer)
      const imported = importEncryptedBackup(blob, recovery_code)
      expect(imported.agent_id).toBe(agent.agent_id)
      expect(imported.public_key).toBe(agent.public_key)
      expect(imported.private_key_seed).toBe(private_key)
    })

    it('restored private key can still sign messages verifiable by the stored public key', () => {
      const result = createAgent({ email_address: 'sigtest@local', display_name: 'SigTest' })
      const { agent, private_key } = result

      const { recovery_code } = createRecoveryPack({
        agent_id: agent.agent_id,
        private_key_seed: private_key,
      })
      const restored = restoreIdentity(agent.agent_id, recovery_code)

      // Sign a message with the restored private key
      const pubRaw = agent.public_key.slice('ed25519:'.length)
      const sig = signMessage('post-recovery message', restored.private_key_seed, pubRaw)

      // Verify with the stored public key from DB
      const dbAgent = getAgentById(agent.agent_id)!
      expect(verifySignature(dbAgent.public_key, 'post-recovery message', sig)).toBe(true)
    })

    it('fails with wrong recovery code', () => {
      const result = createAgent({ email_address: 'wrong@local', display_name: 'Wrong' })
      createRecoveryPack({
        agent_id: result.agent.agent_id,
        private_key_seed: result.private_key,
      })

      expect(() =>
        restoreIdentity(result.agent.agent_id, '000000000000'),
      ).toThrow(/Invalid recovery code/)
    })

    it('fails export when no recovery record exists', () => {
      const result = createAgent({ email_address: 'nopack@local', display_name: 'NoPack' })
      expect(() => exportEncryptedBackup(result.agent.agent_id)).toThrow(/No recovery record/)
    })

    it('overwrites recovery pack on re-creation', () => {
      const result = createAgent({ email_address: 'redo@local', display_name: 'Redo' })

      const first = createRecoveryPack({
        agent_id: result.agent.agent_id,
        private_key_seed: result.private_key,
      })

      const second = createRecoveryPack({
        agent_id: result.agent.agent_id,
        private_key_seed: result.private_key,
      })

      // Both codes are different
      expect(first.recovery_code).not.toBe(second.recovery_code)

      // Only the second code works
      expect(() => restoreIdentity(result.agent.agent_id, first.recovery_code)).toThrow()
      const restored = restoreIdentity(result.agent.agent_id, second.recovery_code)
      expect(restored.agent_id).toBe(result.agent.agent_id)
    })
  })

  // =========================================================================
  // HTTP route tests
  // =========================================================================

  describe('recovery lifecycle (HTTP routes)', () => {
    it('POST create → GET export → POST import', async () => {
      // Create agent
      const createRes = await app.request('/v1/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email_address: 'httprecov@local', display_name: 'HttpRecov' }),
      })
      const { agent: agentData, private_key } = await createRes.json() as {
        agent: { agent_id: string; public_key: string; email_address: string }
        private_key: string
      }

      const agent = {
        agent_id: agentData.agent_id,
        email_address: agentData.email_address,
        public_key: agentData.public_key,
        public_key_raw: agentData.public_key.slice('ed25519:'.length),
        private_key,
      }

      // Create recovery pack via HTTP
      const { status: packStatus, body: packBody } = await req<{ recovery_code: string }>(
        app, 'POST', `/v1/agents/${agent.agent_id}/recovery`,
        { agent, body: { private_key_seed: private_key } },
      )
      expect(packStatus).toBe(201)
      expect(packBody.recovery_code).toMatch(/^\d{12}$/)

      // Export backup via HTTP
      const { status: exportStatus, body: exportBody } = await req<{ blob: string }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/recovery/export`, { agent },
      )
      expect(exportStatus).toBe(200)
      expect(exportBody.blob).toBeString()

      // Import on a "fresh node" via HTTP (no auth needed)
      const importRes = await app.request('/v1/recovery/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blob: exportBody.blob,
          recovery_code: packBody.recovery_code,
        }),
      })
      expect(importRes.status).toBe(200)
      const { identity } = await importRes.json() as {
        identity: { agent_id: string; public_key: string; private_key_seed: string }
      }
      expect(identity.agent_id).toBe(agent.agent_id)
      expect(identity.public_key).toBe(agent.public_key)
      expect(identity.private_key_seed).toBe(private_key)
    })
  })
})

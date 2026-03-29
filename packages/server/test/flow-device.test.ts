// ---------------------------------------------------------------------------
// Phase 2 — Device pairing flow test
//
// Tests the LAN pairing lifecycle:
//   1. New device starts pairing (no auth)
//   2. Host approves with pairing code (auth required)
//   3. Device is bound to agent
//   4. Device can be listed under the agent
//   5. Device can be revoked
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { setupTest, teardownTest, createTestAgent, grantDefaultScopes, req } from './helpers.js'
import { createApp } from '../src/app.js'
import {
  startPairing,
  approvePairing,
  listDevices,
  revokeDevice,
  getDevice,
} from '../src/modules/device/index.js'

const app = createApp({ enableLogger: false })

describe('Phase 2 — Device pairing flow', () => {
  beforeEach(setupTest)
  afterEach(teardownTest)

  // =========================================================================
  // Module-level tests
  // =========================================================================

  describe('pairing lifecycle (module-level)', () => {
    it('start → approve → list → revoke', () => {
      const agent = createTestAgent()

      // Step 1: Device requests pairing
      const session = startPairing({ device_name: 'MacBook Pro' })
      expect(session.session_id).toBeString()
      expect(session.pairing_code).toMatch(/^\d{6}$/)
      expect(session.expires_at).toBeString()

      // Step 2: Host approves with the code
      const device = approvePairing({
        pairing_code: session.pairing_code,
        agent_id: agent.agent_id,
      })
      expect(device.device_id).toBeString()
      expect(device.agent_id).toBe(agent.agent_id)
      expect(device.device_name).toBe('MacBook Pro')
      expect(device.status).toBe('active')
      expect(device.device_fingerprint).toBeString()

      // Step 3: List devices
      const devices = listDevices(agent.agent_id)
      expect(devices.length).toBe(1)
      expect(devices[0].device_id).toBe(device.device_id)

      // Step 4: Revoke device
      revokeDevice(device.device_id)
      const revoked = getDevice(device.device_id)
      expect(revoked?.status).toBe('revoked')
    })

    it('rejects an invalid pairing code', () => {
      createTestAgent()
      expect(() =>
        approvePairing({ pairing_code: '000000', agent_id: 'any' }),
      ).toThrow(/Invalid/)
    })

    it('rejects an expired pairing session', () => {
      const agent = createTestAgent()
      const session = startPairing({ device_name: 'Old Device' })

      // Manually expire the session by updating the DB
      const { dbRun } = require('../src/db/client.js')
      dbRun(
        `UPDATE pairing_sessions SET expires_at = ? WHERE session_id = ?`,
        new Date(Date.now() - 1000).toISOString(),
        session.session_id,
      )

      expect(() =>
        approvePairing({ pairing_code: session.pairing_code, agent_id: agent.agent_id }),
      ).toThrow(/expired/)
    })

    it('rejects reuse of a pairing code', () => {
      const agent = createTestAgent()
      const session = startPairing({ device_name: 'First Device' })

      approvePairing({ pairing_code: session.pairing_code, agent_id: agent.agent_id })

      // Second use of same code should fail
      expect(() =>
        approvePairing({ pairing_code: session.pairing_code, agent_id: agent.agent_id }),
      ).toThrow(/Invalid/)
    })

    it('supports optional per-device public key', () => {
      const agent = createTestAgent()
      const session = startPairing({
        device_name: 'Keyed Device',
        device_public_key: 'base64-device-pubkey',
      })

      const device = approvePairing({
        pairing_code: session.pairing_code,
        agent_id: agent.agent_id,
      })

      expect(device.device_public_key).toBe('base64-device-pubkey')
    })

    it('isolates devices between agents', () => {
      const a1 = createTestAgent('a1@local')
      const a2 = createTestAgent('a2@local')

      const s1 = startPairing({ device_name: 'Device A1' })
      const s2 = startPairing({ device_name: 'Device A2' })

      approvePairing({ pairing_code: s1.pairing_code, agent_id: a1.agent_id })
      approvePairing({ pairing_code: s2.pairing_code, agent_id: a2.agent_id })

      expect(listDevices(a1.agent_id).length).toBe(1)
      expect(listDevices(a2.agent_id).length).toBe(1)
      expect(listDevices(a1.agent_id)[0].device_name).toBe('Device A1')
    })
  })

  // =========================================================================
  // HTTP route tests
  // =========================================================================

  describe('pairing lifecycle (HTTP routes)', () => {
    it('POST start → POST approve → GET devices', async () => {
      const agent = createTestAgent()
      grantDefaultScopes(agent.agent_id)

      // 1. Start pairing (no auth)
      const startRes = await app.request('/v1/pairing/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_name: 'iPhone' }),
      })
      expect(startRes.status).toBe(201)
      const { pairing_code } = await startRes.json() as { pairing_code: string }
      expect(pairing_code).toMatch(/^\d{6}$/)

      // 2. Approve pairing (auth required)
      const { status: approveStatus, body: approveBody } = await req<{
        device: { device_id: string; device_name: string; status: string }
      }>(
        app, 'POST', '/v1/pairing/approve',
        { agent, body: { pairing_code } },
      )
      expect(approveStatus).toBe(201)
      expect(approveBody.device.device_name).toBe('iPhone')
      expect(approveBody.device.status).toBe('active')

      // 3. List devices
      const { status: listStatus, body: listBody } = await req<{ devices: { device_name: string }[] }>(
        app, 'GET', `/v1/agents/${agent.agent_id}/devices`, { agent },
      )
      expect(listStatus).toBe(200)
      expect(listBody.devices.length).toBe(1)
      expect(listBody.devices[0].device_name).toBe('iPhone')
    })

    it('returns 400 for missing device_name on start', async () => {
      const res = await app.request('/v1/pairing/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('returns 403 when listing another agent\'s devices', async () => {
      const a1 = createTestAgent('dev1@local')
      const a2 = createTestAgent('dev2@local')
      grantDefaultScopes(a1.agent_id)
      grantDefaultScopes(a2.agent_id)

      const { status } = await req(
        app, 'GET', `/v1/agents/${a1.agent_id}/devices`, { agent: a2 },
      )
      expect(status).toBe(403)
    })
  })
})

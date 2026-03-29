// ---------------------------------------------------------------------------
// Identity Registry module
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { generateEd25519Keypair, deriveAgentId, randomUuid } from '../../crypto.js'
import type { Agent } from '../../types.js'

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateAgentInput {
  email_address: string
  display_name: string
}

export interface CreateAgentResult {
  agent: Agent
  private_key: string   // raw base64 seed — returned ONCE, never stored
}

export function createAgent(input: CreateAgentInput): CreateAgentResult {
  const existing = getAgentByEmail(input.email_address)
  if (existing) throw new Error(`Agent with email ${input.email_address} already exists`)

  const { publicKey, privateKey } = generateEd25519Keypair()
  const publicKeyField = `ed25519:${publicKey}`
  const agent_id = deriveAgentId(publicKeyField)
  const now = new Date().toISOString()

  const agent: Agent = {
    agent_id,
    email_address: input.email_address,
    display_name: input.display_name,
    public_key: publicKeyField,
    status: 'active',
    mailbox_status: 'unclaimed' as const,
    created_at: now,
    updated_at: now,
  }

  dbRun(
    `INSERT INTO agents (agent_id, email_address, display_name, public_key, status, mailbox_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    agent.agent_id,
    agent.email_address,
    agent.display_name,
    agent.public_key,
    agent.status,
    agent.mailbox_status,
    agent.created_at,
    agent.updated_at,
  )

  return { agent, private_key: privateKey }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function getAgentById(agent_id: string): Agent | null {
  return dbGet<Agent>('SELECT * FROM agents WHERE agent_id = ?', agent_id)
}

export function getAgentByEmail(email_address: string): Agent | null {
  return dbGet<Agent>('SELECT * FROM agents WHERE email_address = ?', email_address)
}

export function listAgents(): Agent[] {
  return dbAll<Agent>('SELECT * FROM agents ORDER BY created_at DESC')
}

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------

export function suspendAgent(agent_id: string): void {
  dbRun(
    `UPDATE agents SET status = 'suspended', updated_at = ? WHERE agent_id = ?`,
    new Date().toISOString(),
    agent_id,
  )
}

export function revokeAgent(agent_id: string): void {
  dbRun(
    `UPDATE agents SET status = 'revoked', updated_at = ? WHERE agent_id = ?`,
    new Date().toISOString(),
    agent_id,
  )
}

// ---------------------------------------------------------------------------
// Mailbox Claim module  (Category 3 — Agenova owns this entirely)
//
// Responsible for:
//   1. Requesting a @agenova.chat mailbox address from the hosted service
//   2. Verifying ownership (Ed25519 challenge/response)
//   3. Binding the mailbox to a local agent
//
// The hosted service is the authority on namespace uniqueness.
// The local server is the authority on identity and key ownership.
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { verifySignature, signMessage, randomUuid } from '../../crypto.js'
import { getAgentById } from '../identity/index.js'
import { hostedRequest, getMailboxDomain, getHostedBaseUrl } from '../../hosted/client.js'
import type { Agent } from '../../types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaimRequest {
  agent_id: string
  handle: string          // desired username, e.g. "alice" → alice@agenova.chat
  private_key_seed: string
  public_key_raw: string  // raw base64 (without "ed25519:" prefix)
}

export interface ClaimResult {
  hosted_mailbox: string  // e.g. alice@agenova.chat
  claim_id: string
}

// ---------------------------------------------------------------------------
// Hosted claim — production path
//
// Phase 1: POST /v1/mailbox/claim/init → get challenge
// Phase 2: POST /v1/mailbox/claim/verify → sign challenge, get mailbox
// Phase 3: Bind locally
// ---------------------------------------------------------------------------

export async function claimMailbox(input: ClaimRequest): Promise<ClaimResult> {
  const agent = getAgentById(input.agent_id)
  if (!agent) throw new Error(`Agent ${input.agent_id} not found`)
  if (agent.hosted_mailbox) throw new Error(`Agent already has a hosted mailbox: ${agent.hosted_mailbox}`)

  // Phase 1 — init
  const initRes = await hostedRequest<{ claim_id: string; challenge: string }>({
    method: 'POST',
    path: '/v1/mailbox/claim/init',
    body: {
      agent_id: input.agent_id,
      handle: input.handle,
      public_key: agent.public_key,
    },
    retries: 2,
  })

  if (!initRes.ok) {
    const msg = (initRes.data as { message?: string })?.message ?? `status ${initRes.status}`
    throw new Error(`Hosted service rejected mailbox claim: ${msg}`)
  }

  const { claim_id, challenge } = initRes.data

  // Phase 2 — sign + verify
  const signature = signMessage(challenge, input.private_key_seed, input.public_key_raw)

  const verifyRes = await hostedRequest<{ hosted_mailbox: string }>({
    method: 'POST',
    path: '/v1/mailbox/claim/verify',
    body: { claim_id, signature },
    retries: 2,
  })

  if (!verifyRes.ok) {
    const msg = (verifyRes.data as { message?: string })?.message ?? `status ${verifyRes.status}`
    throw new Error(`Mailbox ownership verification failed: ${msg}`)
  }

  const { hosted_mailbox } = verifyRes.data

  // Phase 3 — bind locally
  bindMailbox(input.agent_id, hosted_mailbox)

  return { hosted_mailbox, claim_id }
}

// ---------------------------------------------------------------------------
// Local claim — dev/test mode
//
// Simulates the full hosted challenge/sign/verify cycle locally.
// Used when AGENOVA_HOSTED_URL is not set or for offline development.
// Performs the same validation that the hosted service would:
//   - uniqueness check (no two agents can claim the same handle)
//   - challenge generation + Ed25519 signature verification
//   - mailbox binding
// ---------------------------------------------------------------------------

export function claimMailboxLocal(input: ClaimRequest): ClaimResult {
  const agent = getAgentById(input.agent_id)
  if (!agent) throw new Error(`Agent ${input.agent_id} not found`)
  if (agent.hosted_mailbox) throw new Error(`Agent already has a hosted mailbox: ${agent.hosted_mailbox}`)

  const hosted_mailbox = `${input.handle}@${getMailboxDomain()}`

  // Uniqueness check — same as hosted service would do
  const existing = getAgentByHostedMailbox(hosted_mailbox)
  if (existing) throw new Error(`Handle "${input.handle}" is already taken`)

  // Generate a challenge and verify the agent can sign it (proves key ownership)
  const claim_id = randomUuid()
  const challenge = `claim:${hosted_mailbox}:${claim_id}:${new Date().toISOString()}`
  const signature = signMessage(challenge, input.private_key_seed, input.public_key_raw)

  // Verify the signature against the stored public key — same as hosted would
  const valid = verifySignature(agent.public_key, challenge, signature)
  if (!valid) throw new Error('Key ownership verification failed')

  // Bind
  bindMailbox(input.agent_id, hosted_mailbox)

  return { hosted_mailbox, claim_id }
}

// ---------------------------------------------------------------------------
// Auto-select claim mode based on environment
// ---------------------------------------------------------------------------

export async function claimMailboxAuto(input: ClaimRequest): Promise<ClaimResult> {
  if (process.env.AGENOVA_HOSTED_URL) {
    return claimMailbox(input)
  }
  return claimMailboxLocal(input)
}

// ---------------------------------------------------------------------------
// Bind a hosted mailbox to a local agent
// ---------------------------------------------------------------------------

export function bindMailbox(agent_id: string, hosted_mailbox: string): void {
  const now = new Date().toISOString()
  dbRun(
    `UPDATE agents SET hosted_mailbox = ?, mailbox_status = 'claimed', claimed_at = ?, updated_at = ? WHERE agent_id = ?`,
    hosted_mailbox, now, now, agent_id,
  )
}

// ---------------------------------------------------------------------------
// Release (revoke) a hosted mailbox
// ---------------------------------------------------------------------------

export async function releaseMailbox(agent_id: string, private_key_seed: string, public_key_raw: string): Promise<void> {
  const agent = getAgentById(agent_id)
  if (!agent?.hosted_mailbox) throw new Error('No hosted mailbox bound to this agent')

  const challenge = `release:${agent.hosted_mailbox}:${new Date().toISOString()}`
  const signature = signMessage(challenge, private_key_seed, public_key_raw)

  // Best-effort notify hosted service
  await hostedRequest({
    method: 'POST',
    path: '/v1/mailbox/release',
    body: { agent_id, hosted_mailbox: agent.hosted_mailbox, challenge, signature },
    retries: 1,
  }).catch(() => {})

  dbRun(
    `UPDATE agents SET hosted_mailbox = NULL, mailbox_status = 'unclaimed', updated_at = ? WHERE agent_id = ?`,
    new Date().toISOString(), agent_id,
  )
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getAgentByHostedMailbox(hosted_mailbox: string): Agent | null {
  return dbGet<Agent>('SELECT * FROM agents WHERE hosted_mailbox = ?', hosted_mailbox)
}

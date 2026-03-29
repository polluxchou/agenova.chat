// ---------------------------------------------------------------------------
// Policy Engine module
// ---------------------------------------------------------------------------

import { dbGet, dbAll, dbRun } from '../../db/client.js'
import { randomUuid } from '../../crypto.js'
import type { PermissionGrant } from '../../types.js'

// ---------------------------------------------------------------------------
// Grant
// ---------------------------------------------------------------------------

export interface GrantScopeInput {
  agent_id: string
  scope: string
  resource_type?: string
  resource_id?: string
  granted_by: string
  expires_at?: string
}

export function grantScope(input: GrantScopeInput): PermissionGrant {
  const grant: PermissionGrant = {
    grant_id: randomUuid(),
    agent_id: input.agent_id,
    scope: input.scope,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
    granted_by: input.granted_by,
    expires_at: input.expires_at,
    created_at: new Date().toISOString(),
  }

  dbRun(
    `INSERT INTO permission_grants (grant_id, agent_id, scope, resource_type, resource_id, granted_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    grant.grant_id,
    grant.agent_id,
    grant.scope,
    grant.resource_type ?? null,
    grant.resource_id ?? null,
    grant.granted_by,
    grant.expires_at ?? null,
    grant.created_at,
  )

  return grant
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

export function revokeGrant(grant_id: string): void {
  dbRun('DELETE FROM permission_grants WHERE grant_id = ?', grant_id)
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function listGrants(agent_id: string): PermissionGrant[] {
  return dbAll<PermissionGrant>(
    'SELECT * FROM permission_grants WHERE agent_id = ? ORDER BY created_at DESC',
    agent_id,
  )
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export interface CheckPermissionInput {
  agent_id: string
  scope: string
  resource_type?: string
  resource_id?: string
}

export function checkPermission(input: CheckPermissionInput): boolean {
  const now = new Date().toISOString()

  // Check for an exact scope match (with optional resource narrowing)
  const grant = dbGet<PermissionGrant>(
    `SELECT * FROM permission_grants
     WHERE agent_id = ?
       AND scope = ?
       AND (expires_at IS NULL OR expires_at > ?)
       AND (resource_type IS NULL OR resource_type = ?)
       AND (resource_id IS NULL OR resource_id = ?)
     LIMIT 1`,
    input.agent_id,
    input.scope,
    now,
    input.resource_type ?? null,
    input.resource_id ?? null,
  )

  return grant !== null
}

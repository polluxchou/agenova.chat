# Agent Identity and Mail Fusion - Version 1 Development Document

## Overview

This document defines the first runnable version of the fusion between:

- `nit` for agent identity, signing, and key-based ownership
- `mails` for mailbox-style communication, inbox storage, search, and attachments

The goal of Version 1 is not to standardize the full ecosystem. The goal is to build a small, local-first system that proves the core idea:

- an email address can be the unique identity of an agent
- identity is cryptographically owned
- agents can communicate through a mailbox-like protocol
- memory, permissions, and model API keys can be controlled by policy

## Version 1 Scope

### In Scope

- Single-node local hosting
- Support for multiple devices on the same local network
- No public internet dependency
- Email address as the unique agent identity
- Ed25519-based signing and verification
- Secure message exchange with optional encryption
- Controlled memory access
- Controlled access to model API keys
- Device pairing and device revocation

### Out of Scope

- Public internet mail routing
- Cross-organization agent federation
- Full standardization of the protocol
- Marketplace or billing features
- Advanced multi-tenant enterprise policy systems

## Product Goal

Version 1 should allow two or more agents on the same local network to:

1. create or load an identity
2. pair a new device
3. exchange signed messages
4. verify the identity of the sender
5. store and retrieve controlled memory
6. use allowed model API keys through a broker

## Core Design Principles

### 1. Email is the identity handle

An agent's email address is the user-facing identity.

Example:

- `alice@local`
- `research@home`
- `ops@lab`

The email address is the stable lookup key. The cryptographic keypair is the real ownership root.

### 2. Identity is cryptographic

The `nit` layer provides:

- Ed25519 keypair generation
- public key embedding
- message signing
- domain-bound login-style signing
- deterministic agent ID derivation

### 3. Communication is mailbox-based

The `mails` layer provides:

- inbox/outbox storage
- message search
- attachments
- code extraction
- persistence

### 4. Sensitive operations are centralized locally

The local coordination server is the trust boundary for Version 1.

It should own:

- identity registry
- permission checks
- message routing
- memory access control
- key broker access
- device registration

### 5. Memory and model keys are policy-scoped

Agents do not get unrestricted access to memory or model credentials.

Every access must be checked against policy rules.

## System Architecture

### Modules

#### 1. Local Coordination Server

The main local service that connects all other modules.

Responsibilities:

- create and load agent identities
- bind email address to agent identity
- verify signatures
- route messages
- enforce permissions
- manage memory
- manage model keys
- handle local network device pairing

#### 2. Identity Registry

Stores the mapping:

- email address -> agent ID -> public key

Responsibilities:

- create agent identity
- load existing identity
- rotate or revoke devices
- expose identity metadata to authorized clients

#### 3. Recovery Vault

Stores encrypted recovery material for identity restoration.

Responsibilities:

- export encrypted recovery bundle
- import recovery bundle
- restore identity on a new device
- support device reset and re-binding

#### 4. Policy Engine

Decides whether an action is allowed.

Responsibilities:

- check mailbox read/write permissions
- check memory access permissions
- check model key usage permissions
- check device management permissions
- check identity restoration permissions

#### 5. Mailbox Service

Uses the `mails` data model and transport patterns.

Responsibilities:

- send mailbox messages
- receive mailbox messages
- store message history
- support search and attachments
- support signed envelopes

#### 6. Memory Ledger

Stores long-term memory items under access control.

Responsibilities:

- append memory items
- retrieve memory items
- update or delete memory items
- share memory by policy

#### 7. Model Key Broker

Manages model API keys as controlled assets.

Responsibilities:

- store encrypted keys
- allow scoped usage
- proxy model calls
- record usage logs

#### 8. LAN Discovery and Pairing

Allows devices on the same local network to find and bind to the local node.

Responsibilities:

- discover the host
- start pairing
- approve pairing
- bind device identity
- revoke device identity

## Reuse Strategy

### From `nit`

Reuse:

- Ed25519 identity generation
- public key encoding
- agent ID derivation
- signature generation and verification
- deterministic wallet derivation

Do not reuse directly as-is:

- branch-per-platform as the main interaction model
- remote card publishing as the main transport model

### From `mails`

Reuse:

- email schema and message shape
- inbox and search concepts
- attachment support
- local and remote storage abstractions
- worker-based message storage patterns

Do not reuse directly as-is:

- hosted internet mail assumptions
- mailbox token model as the only trust boundary

## Minimal Data Model

### Agent

```ts
type Agent = {
  agent_id: string
  email_address: string
  display_name: string
  public_key: string
  status: 'active' | 'suspended' | 'revoked'
  created_at: string
  updated_at: string
}
```

### Device

```ts
type Device = {
  device_id: string
  agent_id: string
  device_name: string
  device_fingerprint: string
  device_public_key?: string
  status: 'pending' | 'active' | 'revoked'
  last_seen_at: string
  created_at: string
}
```

### Permission Grant

```ts
type PermissionGrant = {
  grant_id: string
  agent_id: string
  scope: string
  resource_type?: string
  resource_id?: string
  granted_by: string
  expires_at?: string
  created_at: string
}
```

### Mail Envelope

```ts
type MailEnvelope = {
  message_id: string
  thread_id: string
  from_agent: string
  to_agent: string
  message_type: 'task' | 'reply' | 'note' | 'approval' | 'system'
  subject: string
  body: string
  headers: Record<string, string>
  signature: string
  encryption_meta?: {
    algorithm: string
    recipient_key_id: string
  }
  scope?: string
  created_at: string
}
```

### Memory Item

```ts
type MemoryItem = {
  memory_id: string
  owner_agent_id: string
  memory_type: 'conversation_summary' | 'task_state' | 'tool_result' | 'fact' | 'note'
  title: string
  content_ciphertext: string
  content_hash: string
  visibility: 'private' | 'shared' | 'public'
  tags: string[]
  created_at: string
  updated_at: string
}
```

### Model Key

```ts
type ModelKey = {
  key_id: string
  agent_id: string
  provider: 'openai' | 'anthropic' | 'google' | 'other'
  alias: string
  encrypted_secret: string
  status: 'active' | 'revoked'
  created_at: string
  last_used_at?: string
}
```

## Core APIs

### Identity Registry

- `createAgent(emailAddress, displayName)`
- `getAgentByEmail(emailAddress)`
- `getAgentById(agentId)`
- `rotateDevice(agentId, deviceId)`
- `revokeDevice(agentId, deviceId)`

### Recovery Vault

- `createRecoveryPack(agentId)`
- `verifyRecoveryCode(agentId, recoveryCode)`
- `restoreIdentity(agentId, recoveryCode)`
- `exportEncryptedBackup(agentId)`
- `importEncryptedBackup(blob, passphrase)`

### Policy Engine

- `grantScope(agentId, scope, resourceId?)`
- `revokeScope(agentId, scope, resourceId?)`
- `checkPermission(agentId, action, resourceType, resourceId?)`
- `listScopes(agentId)`

Suggested scopes:

- `mail.read`
- `mail.write`
- `memory.read`
- `memory.write`
- `model.use`
- `device.manage`
- `identity.restore`

### Mailbox Service

- `buildEnvelope(message)`
- `signEnvelope(envelope, agentId)`
- `encryptEnvelope(envelope, recipientPublicKey)`
- `verifyEnvelope(envelope)`
- `decryptEnvelope(envelope, privateKey)`

### Memory Ledger

- `appendMemory(agentId, item)`
- `getMemory(agentId, query)`
- `updateMemory(itemId, patch)`
- `deleteMemory(itemId)`
- `shareMemory(agentId, targetAgentId, policy)`

### LAN Discovery and Pairing

- `discoverNode()`
- `startPairing()`
- `approvePairing(pairingCode)`
- `bindDevice(agentId, deviceFingerprint)`
- `unpairDevice(deviceId)`

### Model Key Broker

- `storeModelKey(agentId, provider, alias, encryptedKey)`
- `listModelKeys(agentId)`
- `grantKeyUsage(agentId, keyAlias, scope)`
- `invokeModel(agentId, keyAlias, payload)`
- `revokeModelKey(agentId, keyAlias)`

## First-Phase Flow

### 1. Create identity

- The user creates an agent.
- The system generates a keypair and a stable agent ID.
- The system binds the agent to an email address.

### 2. Pair a device

- A new device joins the local network.
- The device requests pairing.
- The host approves the pairing.
- The device receives limited access.

### 3. Send a message

- Agent A creates a signed mail envelope.
- The coordination server validates the policy.
- The mailbox service stores and routes the message.
- Agent B receives the message and verifies the signature.

### 4. Read memory

- Agent B requests memory access.
- The policy engine checks the scope.
- If allowed, the memory ledger returns the data.

### 5. Use a model key

- Agent B requests a model call.
- The broker checks whether the key is allowed.
- The broker proxies the call and logs the usage.

## Storage Recommendation

For Version 1, use a single local database with the following tables:

- `agents`
- `devices`
- `recovery_records`
- `permission_grants`
- `mail_envelopes`
- `memory_items`
- `model_keys`
- `pairing_sessions`

This keeps the first version simple and makes it easier to extend later.

## Success Criteria

Version 1 is successful if it can:

- create and load an agent identity
- map an email address to that identity
- pair at least one local device
- send and receive signed messages
- verify sender identity
- store and read controlled memory
- proxy at least one allowed model API key
- run without public internet dependency

## Non-Goals

Version 1 will not:

- connect to public email infrastructure
- expose the system to the public internet
- implement full inter-agent federation
- implement a final protocol standard
- implement a full billing or marketplace layer

## Next Step

The next implementation step should be a technical plan that defines:

- server endpoints
- local storage schema
- LAN pairing flow
- message envelope format
- permission checks
- which parts of `nit` and `mails` are imported directly


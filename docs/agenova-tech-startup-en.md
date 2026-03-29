# Agenova Technical Startup Brief

This document is the English technical starting point for implementation. It is intentionally scoped to let engineering begin work immediately while keeping the ownership boundaries clear.

## 1. Product Goal

Agenova is a local-first agent identity and mailbox coordination system.

- `nit` provides the identity and signing foundation
- `mails` provides mature mailbox capabilities as the reference layer
- Agenova owns identity binding, mailbox claim, permissions, memory, device recovery, and local coordination

The first delivery goal is to let a user:

- start Agenova locally
- create an agent identity
- request and bind an `@agenova.chat` mailbox
- send and receive mail
- extract verification codes automatically
- restore and continue the same identity across devices

## 2. Architecture Boundary

### 2.1 Reuse from `mails`

`mails` should be reused for mature email capabilities, but not pulled in as a runtime dependency for Agenova.

Reusable capabilities include:

- email storage
- inbox and outbox listing
- full-text search
- verification code extraction
- attachment handling
- mail sync to local storage
- SQLite storage and index patterns
- mail field naming conventions

### 2.2 Reuse from `nit`

`nit` is the identity layer for Agenova.

It provides:

- Ed25519 identity generation
- signing and verification
- stable agent ID derivation
- cryptographic ownership control

### 2.3 What Agenova Must Own

If Agenova does not own these, it becomes only a mail wrapper.

- agent creation and identity lifecycle
- `@agenova.chat` mailbox claim flow
- mailbox-to-agent binding
- hosted namespace uniqueness
- permission management
- memory management
- multi-device pairing and recovery
- local coordination service
- the local-to-hosted handshake protocol

## 3. Capability Categories

### Category 1: Reuse from `mails`

| Capability | How to handle it | Why |
|---|---|---|
| Email receiving and storage | Reuse | This is a mature mailbox primitive |
| Inbox / outbox listing | Reuse | Standard mailbox functionality |
| Email search | Reuse | Already proven in `mails` |
| Verification code extraction | Reuse | Required by the PRD and already mature |
| Attachment handling | Reuse | Common mailbox capability |
| Mail sync | Reuse | Fits the local-first direction |
| SQLite/WAL/index patterns | Reuse | Good reference for local persistence |
| Mail field naming | Reuse | Improves compatibility and consistency |

### Category 2: Borrow as design, not code

| Capability | How to handle it | Why |
|---|---|---|
| Mail schema | Reference only | Agenova needs identity and policy semantics too |
| Search implementation ideas | Reference only | The integration boundary is different |
| Verification extraction rules | Reference only | Behavior can be reused without copying architecture |
| Sync model | Reference only | Agenova needs its own handshake and retry behavior |
| Hosted mailbox interaction model | Reference only | Different trust boundary and product scope |

### Category 3: Agenova-owned capabilities

| Capability | Module / Owner |
|---|---|
| Agent creation and lifecycle | `modules/identity` |
| `nit` identity integration | `crypto.ts` and identity-related modules |
| `@agenova.chat` mailbox claim | `modules/mailbox-claim` |
| Local-to-hosted handshake | `modules/mailbox-claim` + `modules/hosted-sync` |
| Hosted namespace binding | `agents.hosted_mailbox` + `bindMailbox()` |
| Permission management | `modules/policy` |
| Memory management | `modules/memory` |
| Multi-device pairing and recovery | `modules/device` + `modules/recovery` |
| Local coordination service | `index.ts` + middleware |

## 4. Recommended Build Order

### Phase 1: Foundation

First, make the core server testable and stable.

- add test infrastructure for the server
- add reset hooks for cached DB and master key state
- split the Hono app into a testable app factory
- cover the critical identity, auth, and policy paths with unit tests

### Phase 2: Identity and Mailbox Binding

Build the product's main user flow.

1. create a local agent
2. generate Ed25519 identity
3. request an `@agenova.chat` mailbox
4. bind the mailbox to the agent
5. persist hosted mailbox metadata

### Phase 3: Mailbox Capabilities

Map mature `mails` behavior into Agenova's mailbox layer.

- receive mail
- list inbox and outbox
- search mail
- extract verification codes
- handle attachments
- sync mail locally

### Phase 4: Policy, Memory, Device, Recovery

After the core mailbox flow is working, expand the rest of the product boundary.

- policy
- memory
- device pairing
- recovery

### Phase 5: Cross-Compatibility

Verify that `nit` and Agenova agree on identity and signature conventions.

- identical agent IDs for the same public key
- `nit`-signed messages verifiable by Agenova
- matching public key field conventions

## 5. Implementation Principles

- Prefer reuse over reinvention
- Keep identity ahead of mailbox naming
- Keep the hosted layer focused on naming and reachability
- Keep Agenova's core ownership around identity, permissions, memory, recovery, and coordination
- Use tests to protect the ownership boundary early

## 6. Acceptance Criteria for Launch

The first development milestone is successful when:

- Agenova can start locally
- an agent identity can be created
- an `@agenova.chat` mailbox can be requested and bound
- mail can be received and searched
- verification codes can be extracted automatically
- the same identity can be restored on another device
- the critical server and identity paths are covered by tests

## 7. Non-Blocking Follow-Ups

These items should be refined during implementation, but they do not block the start of development:

- the exact mailbox claim protocol fields
- retry and timeout behavior for local-to-hosted sync
- sync frequency
- error code definitions
- hosted namespace conflict handling
- final runtime choice details

## 8. Final Working Summary

Agenova should reuse `mails` for mature mailbox capabilities and `nit` for identity. Agenova itself must own mailbox claim, binding, permissions, memory, device recovery, and local coordination. That is the boundary that keeps Agenova an identity system, not just a mail wrapper.

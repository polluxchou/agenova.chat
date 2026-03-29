# mails ↔ Agenova: Boundary & Reuse Guide

> **For the team.** Use this to make consistent decisions about what to reuse, what to reference, and what Agenova must own.

---

## Summary

> `mails` provides the mailbox communication layer.
> `Agenova` provides identity, mailbox binding, permissions, memory, and local coordination.
>
> Reuse the mature email capabilities from `mails`. Do not make `mails` the main architecture of Agenova.

---

## 1. Direct Reuse

These capabilities are mature in `mails` and should be reused directly, or kept very close to the existing implementation.

| Area | What to reuse |
|---|---|
| Email receiving & storage | Inbound email handling, MIME parsing, attachment extraction |
| Inbox / outbox queries | Filtering, pagination, read/unread state |
| Email search | Full-text search logic and SQLite FTS patterns |
| Verification code extraction | Parsing rules and regex patterns from `extract-code` |
| Attachment handling | Storage, retrieval, and MIME type detection |
| Mail sync to local storage | Sync mechanism between remote and local SQLite |
| Mail data structures | Field naming, envelope structure, thread shape |
| SQLite storage patterns | Schema conventions, index design, query patterns |

**Why:** `mails` is already production-ready in the core mailbox area. Agenova does not need to rebuild these from scratch.

---

## 2. Reference — Design Only, Not Runtime Dependency

These `mails` patterns should inform Agenova's design, but `mails` should not be a hard runtime dependency for them.

| Area | What to borrow |
|---|---|
| Mail table schema | Use as a reference model, adapt for Agenova's schema |
| Search implementation | Apply ideas, but own the implementation |
| Verification code extraction | Rules can be copied, not imported |
| Inbox sync mechanism | Pattern is useful; adapt for Agenova's local coordination layer |
| Worker / hosted mailbox interaction | Use the model, but mediate through Agenova's own server layer |

**Why:** Agenova is not just an email client. It is a local coordination layer for identity, mailbox, permissions, and memory. The right pattern is to borrow the design, not to sit directly on top of `mails`.

---

## 3. Agenova Owns Exclusively

These are core responsibilities that `mails` does not cover and should not own. If Agenova delegates these, it becomes a mail wrapper instead of an agent identity system.

| Area | Description |
|---|---|
| Agent creation | Provisioning new agents with identity and namespace |
| nit identity integration | Binding Ed25519 keys, agent cards, and version history |
| Mailbox claiming for `agenova.chat` | Allocating and reserving hosted namespaces |
| Mailbox ↔ agent binding | Associating a mailbox address to a specific agent identity |
| Hosted namespace uniqueness | Enforcing uniqueness and allocation across the hosted layer |
| Permission management | Capability grants, policy enforcement, access control |
| Memory management | Agent memory storage, scoping, and retrieval |
| Multi-device pairing & recovery | Device registration, pairing handshake, recovery flows |
| Local coordination service | The server that ties identity, mailbox, memory, and policy together |
| Local ↔ hosted handshake protocol | The trust and sync protocol between local server and hosted layer |

**Why:** These define Agenova's product boundary and are the main differentiator from `mails`. These must be owned, tested, and versioned by Agenova.

---

## Decision Checklist

When adding a new capability, ask:

1. **Does `mails` already do this well?** → Reuse directly (Category 1)
2. **Does `mails` have a good pattern but Agenova needs control?** → Reference the design, own the code (Category 2)
3. **Is this about identity, binding, permissions, memory, or coordination?** → Agenova owns it, do not delegate to `mails` (Category 3)

# Agenova Risk Log

This document is a living record of known product and protocol risks.  
When a new risk is identified, add a new entry here instead of scattering notes across separate docs.

## Update Rules

- Keep entries concise and concrete.
- Record the user-visible impact first.
- Add the current status: `open`, `mitigated`, `accepted`, or `resolved`.
- When a mitigation lands, update the same entry instead of creating a duplicate.

## R-001: Reused mailbox can expose historical mail to the new owner

- **Status:** open
- **Area:** hosted mailbox claim / inbox sync / mail retention
- **Summary:** If an `@agenova.chat` mailbox is released and later claimed by a different agent, the mailbox name is reused. Current inbox lookup and sync logic are mailbox-name-based, so historical mail for that mailbox may still be visible to the new agent.
- **User impact:** A later owner of the same mailbox may see older messages that were sent before the mailbox was re-claimed.
- **Why this happens:** Mail storage and retrieval are currently keyed by `mailbox`, not by a mailbox ownership epoch or claim generation. Release changes ownership state, but does not automatically separate historical mail from future mail.
- **Current behavior:** Released handles can be re-claimed. Existing mail rows are retained unless explicitly purged or partitioned by a future ownership marker.
- **Evidence:**
  - Hosted inbox serves emails by `mailbox` query.
  - Local sync pulls emails by `mailbox`.
  - Mail storage does not yet track a claim-generation boundary.
- **Possible mitigations:**
  - Delete or archive historical mail on release.
  - Introduce a mailbox ownership epoch / generation ID.
  - Sync only mail received after the latest claim timestamp.
  - Block handle reuse entirely for some mailbox classes.

## R-002: Mailbox naming rules are still minimal

- **Status:** open
- **Area:** mailbox claim validation
- **Summary:** Current validation checks basic format and uniqueness, but does not yet implement reserved words, profanity filtering, brand protection, or admin-only namespaces.
- **User impact:** Some mailbox names that should probably be reserved are still claimable today.
- **Current behavior:** A handle is accepted if it matches the basic format rule and is not already active.
- **Possible mitigations:**
  - Add a reserved-name list.
  - Add policy-based namespace protection.
  - Add moderation or approval for sensitive names.

## R-003: One physical machine can host multiple agents, which can confuse operators if not isolated clearly

- **Status:** open
- **Area:** device management / multi-instance usage
- **Summary:** A single Mac mini or cloud host can run multiple agent instances, but each agent still needs separate identity, keys, and local state boundaries.
- **User impact:** If operators mix multiple agents inside one shared runtime, credentials, mail, or memory can be confused.
- **Current behavior:** The system supports multiple agents on the same machine, but the product still relies on clear instance boundaries rather than a single shared session.
- **Possible mitigations:**
  - Make per-agent workspaces or containers the default.
  - Add explicit profile switching in the UI or CLI.
  - Prevent shared-state reuse across agents.

## R-004: Public keys are intentionally visible, so private key handling is the real security boundary

- **Status:** accepted
- **Area:** identity / authentication
- **Summary:** Public keys and derived agent IDs are intended to be shareable. The security boundary is the private key, not the public key.
- **User impact:** None by itself. Risk appears only if private keys, recovery codes, or backups leak.
- **Current behavior:** The system exposes public identity material for verification and lookup.
- **Possible mitigations:**
  - Keep private keys out of logs and plain-text storage.
  - Encrypt backups and recovery bundles.
  - Support device revocation and identity re-creation.


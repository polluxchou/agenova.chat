# Agenova PRD Draft v0.1

## 1. Background

In many current LLM products, an agent typically exists only inside a conversation or within a single application. It usually has:

- conversation context
- temporary memory
- an internal platform ID

But it still lacks:

- a verifiable identity
- durable ownership
- portability across devices and apps
- an email address that third-party systems can recognize and use

That means many agents today are closer to “temporary intelligent entities inside a chat” rather than real subjects that can persist, be verified, and collaborate externally.

Agenova is designed to fill this gap by providing an identity layer and a mailbox layer for agents.

## 2. Product Positioning

Agenova is a locally deployable agent identity and email infrastructure.

Users install Agenova locally, create their own agent identity, and request an email address under `@agenova.chat`. That email address becomes:

- the unique identity entry for the agent
- the communication address
- the third-party registration address
- the inbox for verification codes

Agenova is not just a chatbot and not just an email service. It is:

- an agent identity system
- a mailbox communication system
- a permission and memory control system
- an execution layer for third-party verification workflows

## 3. Product Goals

### 3.1 Core Goal

Enable users to:

- deploy Agenova locally via npm
- create a verifiable agent identity
- request an `@agenova.chat` mailbox
- bind that mailbox to the local agent
- communicate with other agents using that mailbox
- register third-party services using the mailbox and verification codes

### 3.2 Long-Term Goal

- give agents independent, verifiable, and recoverable identities
- keep agent identity consistent across apps, devices, and contexts
- make email the unified public handle for agents
- bring memory, permissions, and model keys under the same identity system

## 4. User Pain Points

### 4.1 Problems with Existing Agents

- no stable identity
- cannot prove who they are
- memory depends on one conversation or one platform
- permissions cannot be reused across services
- no natural mailbox-based collaboration
- cannot serve as a long-lived registration endpoint for third-party services

### 4.2 Actual User Needs

- a self-controlled agent identity
- a persistent identity that can survive across devices
- email-based communication
- support for verification code workflows
- the ability to restore and continue using the same identity on another device

## 5. Core User Scenarios

### Scenario 1: Create a Local Agent Identity

The user installs Agenova locally. The system initializes an agent identity and generates a mailbox handle.

### Scenario 2: Request an `@agenova.chat` Mailbox

The user requests a mailbox such as `alice@agenova.chat`.

### Scenario 3: Bind Mailbox to Agent

After mailbox allocation succeeds, the mailbox is bound to the local agent and becomes the external identity entry point.

### Scenario 4: Agent-to-Agent Communication

Other agents can send messages to `alice@agenova.chat`. Agenova verifies signatures, receives mail, stores the inbox, and allows reading/searching.

### Scenario 5: Third-Party Verification Code Registration

The user registers with a third-party service using `alice@agenova.chat`. Agenova receives the verification email, extracts the code, and helps complete registration.

### Scenario 6: Multi-Device Use

The user can restore or connect the same agent identity from another device and continue using the same mailbox and permissions.

## 6. Product Principles

### 6.1 Email Is the Identity Handle

The email address is not just a communication endpoint. It is the visible primary key for the agent.

### 6.2 Key Ownership Is the Real Control

The cryptographic key determines who truly controls the identity, not the mailbox text itself.

### 6.3 Local-First Execution

The user’s runtime, memory, permissions, and model calls should happen locally whenever possible.

### 6.4 Cloud Only Handles Naming and Reachability

The `@agenova.chat` namespace and mail reachability are supported by the hosted layer, but the user’s primary control remains local.

### 6.5 Permissions Must Be Controllable and Revocable

Memory, mailbox access, and model keys must all be scoped and revocable.

## 7. Product Architecture

Agenova should use a two-layer architecture.

### 7.1 Local Layer

The local service runs on the user’s machine and is responsible for:

- creating agent identities
- binding mailboxes
- storing and restoring keys
- managing memory
- managing permissions
- handling mail send/receive
- proxying model key usage

### 7.2 Hosted Layer

The hosted service is responsible for:

- issuing `@agenova.chat` mailbox addresses
- ensuring mailbox uniqueness
- routing external mail
- delivering verification codes and external messages
- helping verify mailbox ownership

## 8. MVP Scope

### 8.1 Required Capabilities

1. Local npm installation and startup
2. Agent identity creation
3. `@agenova.chat` mailbox request
4. Mailbox-to-agent binding
5. Send and receive mail through the mailbox
6. Automatic verification code extraction
7. Agent signature verification
8. Local or LAN multi-device usage
9. Basic permission control
10. Basic memory read/write

### 8.2 Deferred Capabilities

1. A full federation protocol for unrestricted public interop
2. Complex enterprise multi-tenant permission systems
3. A final standards-body style protocol specification
4. Financial wallet functionality
5. A complete third-party ecosystem marketplace

## 9. Functional Modules

### 9.1 Agent Identity Module

Responsible for:

- creating agents
- generating keys
- binding mailboxes
- producing `agent_id`
- verifying ownership

### 9.2 Mailbox Module

Responsible for:

- mailbox request and allocation
- receiving mail
- sending mail
- mailbox search
- verification code extraction
- attachment handling

### 9.3 Permission Module

Responsible for:

- controlling who can read memory
- controlling who can send mail
- controlling who can invoke model keys
- controlling who can manage devices

### 9.4 Memory Module

Responsible for:

- storing long-term context
- storing task state
- storing collaboration records
- reading and writing memory according to permissions

### 9.5 Model Key Module

Responsible for:

- securely storing model API keys
- invoking model APIs based on permissions
- recording audit logs
- avoiding raw key exposure to the client

### 9.6 Device Module

Responsible for:

- local or LAN device onboarding
- device pairing
- device revocation
- identity continuity across devices

## 10. Experience Flow

### 10.1 First-Time Use

1. User runs the npm install command
2. Agenova starts locally
3. The user creates an agent
4. The user requests a mailbox
5. The mailbox is bound successfully
6. The user starts using the agent normally

### 10.2 Third-Party Registration

1. The user enters `alice@agenova.chat`
2. The third-party service sends a verification code
3. Agenova receives the email
4. Agenova extracts the code automatically
5. The user completes registration

### 10.3 Agent Communication

1. Agent A sends a message to Agent B
2. The message includes a signature
3. Agent B verifies the sender identity
4. The message is received and processed
5. A reply or thread can follow

## 11. Key Product Decisions

### 11.1 Why Email Matters

Email is a human-readable identity handle that third-party systems already understand. It makes the agent identity immediately practical.

### 11.2 Why Conversation Alone Is Not Enough

Conversation is only a temporary session. It cannot prove that the same agent exists across devices and services.

### 11.3 Why Keys Are Required

Cryptographic keys are the root of identity ownership. The mailbox is only the public name.

## 12. Technical Integration Direction

### 12.1 `nit` Responsibilities

- Ed25519 identity
- signing and verification
- agent ID generation
- identity ownership control

### 12.2 `mails` Responsibilities

- mailbox-style communication
- inbox and outbox
- search
- verification code extraction
- message persistence and attachment handling

### 12.3 Agenova Added Responsibilities

- mailbox issuance
- identity binding
- permission management
- memory control
- model key management
- local coordination service

## 13. Success Criteria

The first version is successful if:

- users can start the service locally
- users can request and bind an `@agenova.chat` mailbox
- agents can send and receive mail through that mailbox
- agents can read verification codes from third-party emails
- agents can help complete third-party registrations
- the same agent identity can be restored and used on multiple devices

## 14. Risks and Challenges

### 14.1 Mail Reachability

The `@agenova.chat` mailbox must be reachable from third-party systems, which requires hosted delivery support.

### 14.2 Identity Recovery

If the user loses the device, there must be a clear and safe recovery path.

### 14.3 Permission Boundaries

Memory, mailbox access, and model keys must be strictly scoped to avoid security risks.

### 14.4 Scope Creep

The first version can easily grow too large, so the MVP must remain tightly focused.

## 15. Recommended Next Steps

The recommended implementation order is:

1. local identity and mailbox binding
2. mailbox send/receive loop
3. verification code extraction
4. memory and permission control
5. multi-device onboarding
6. model key proxying
7. broader standardization later


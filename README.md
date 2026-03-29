# Agenova

Agenova is an early-stage email coordination system built around a simple idea: email should be something you can actually build on top of.

Instead of treating a mailbox as a passive place where messages arrive and wait, Agenova turns it into a small programmable workflow layer. It gives you a way to claim a mailbox, receive inbound messages, sync them into a local application, and send messages back out through a hosted service. The goal is not to replace email providers or become a giant mail platform. The goal is to make email feel like a practical building block for products, internal tools, and AI-assisted workflows.

This project is intentionally still rough. The current focus is on getting the core loop working end to end: claim, receive, sync, send, and deploy. The system is designed to be simple enough to understand, but flexible enough to evolve as the product becomes clearer.

## What Agenova is for

Agenova is meant for people who want to do something active with a mailbox, not just read mail from it.

Some example use cases:

- a mailbox for a product or agent that needs to receive and process messages
- a workflow inbox for internal tools
- a coordination layer for bots or AI assistants
- a lightweight inbound mail store that syncs back into a local app
- an email backend that can be deployed to your own domain and owned by your own system

The core idea is that a mailbox can be claimed, attached to an owner, and used as a stable coordination point. Once that mailbox is claimed, Agenova can keep the public email boundary separate from your application logic. That makes the system easier to deploy, easier to reason about, and easier to swap infrastructure later.

## What Agenova does

Agenova is split into two parts:

- a hosted API server
- a local application server

The hosted server is the public side. It handles mailbox claims, inbound webhooks, inbox reads, and outbound queuing. This is the service that lives at something like `api.agenova.chat`.

The local server is the product side. It talks to your app, syncs inbound messages, and uses the hosted API to send outbound mail when needed. That separation is deliberate. It keeps the email boundary in one place and keeps your application logic in another.

The main workflow looks like this:

1. A mailbox is claimed through the hosted server.
2. Inbound email arrives at the hosted webhook endpoint.
3. The hosted server stores the message.
4. The local server syncs messages from the hosted inbox.
5. Your app processes the message.
6. If needed, your app sends a reply through the hosted send endpoint.
7. The hosted delivery worker forwards the message through a provider such as Resend or Mailgun.

That gives you a clean, predictable loop:

- claim a mailbox
- receive mail
- sync mail
- send mail
- keep the system easy to operate

## Why this exists

A lot of email tooling tends to fall into one of two extremes.

On one side, you have full mail platforms that are powerful but heavy. On the other side, you have simple SMTP setups that are easy to start with but hard to turn into a real workflow. Agenova is trying to sit between those two extremes.

The goal is not to build a giant provider. The goal is to build a narrow, practical coordination layer for projects that need mailbox ownership, inbound capture, sync back into a local database, and outbound delivery.

That is useful for products that need:

- deterministic mailbox ownership
- inbound email capture
- local sync of messages
- outbound email delivery
- a clear hosted/local boundary

Agenova is also being built with AI and automation use cases in mind. A lot of future systems will probably need a mailbox that acts less like a static inbox and more like a structured interface. Agenova is exploring that direction in a simple, deployable way.

## Current architecture

The current implementation was developed in phases, with the hosted API and local server working together as a coordinated system.

The hosted side includes:

- mailbox claim init and verify endpoints
- mailbox release handling
- inbox reads with authentication
- outbound send queuing
- inbound webhook intake
- delivery worker support
- maintenance tasks for expiring claim challenges

The local side includes:

- claim and sync logic
- mailbox and identity handling
- inbox and inbound message handling
- policy and recovery flows
- support for syncing hosted messages into the local database

The hosted service is intentionally lightweight. It runs on Bun, uses Hono, and stores state in SQLite. That keeps the deployment simple enough for early usage, while leaving room to expand later if the system grows.

## How to use Agenova

If you want to use Agenova, the basic setup is:

1. Deploy the hosted server.
2. Point your domain DNS to the hosted service.
3. Configure inbound email routing so messages reach the webhook.
4. Set up an outbound email provider such as Resend.
5. Create an API token for your local server.
6. Point your local app at the hosted URL.
7. Start claiming mailboxes and syncing messages.

In practice, the flow looks like this:

- your app claims a mailbox
- an email arrives for that mailbox
- the hosted server stores the message
- your local server syncs it down
- your app processes the message
- if needed, your app replies through the hosted queue

That means the local side can stay focused on product behavior, while the hosted side handles the email boundary and delivery mechanics.

## What you need to set up

At minimum, you will usually need:

- a domain for the email workflow
- hosted infrastructure for `api.agenova.chat`
- inbound routing for email delivery
- an outbound provider such as Resend or Mailgun
- a persistent database for the hosted service
- a local API token so the local server can talk to the hosted one

The exact setup depends on which provider you choose, but the architecture is meant to stay simple. The hosted side is designed to be deployable on common platforms like Fly.io, Railway, or a VPS.

## Status

Agenova is still early.

The codebase already covers the main claim, sync, inbound, and outbound flows, but it should still be treated as an evolving system rather than a finished platform. The implementation exists because the core loop is now real enough to test and use, but there is still a lot left to polish.

That is intentional. The project is being built in small steps so the system stays understandable and the boundaries stay clear.

## Acknowledgements / Credits

Agenova was inspired by and built with reference to:

- [newtype-ai/nit](https://github.com/newtype-ai/nit)
- [chekusu/mails](https://github.com/chekusu/mails)

Huge thanks to the original authors for sharing thoughtful open-source work and ideas. Agenova combines the mailbox coordination and sync ideas from these projects into an independent system focused on simple deployment and practical email workflows.

This repository is not a copy of either upstream project. It is its own implementation, but the direction and thinking were strongly shaped by the work those projects shared publicly.


# Agenova

Agenova is an early-stage experiment around one problem: how should an agent prove who it is when email becomes part of the workflow?

I did not start with a full product vision. I started with two open-source projects that already pointed in a useful direction: `nit` gave me a shape for mailbox coordination and sync, while `mails` gave me a mailbox-first way of thinking about email handling. Agenova is the rough intersection of those two ideas. It is the place where I tried to connect them into something small, practical, and testable.

The result is not a finished platform. It is closer to a working sketch. Agenova lets an agent claim a mailbox, receive inbound messages, sync them into a local system, and send messages back through a hosted service. That loop is enough to explore identity, ownership, and message flow without pretending the hard parts are already solved.

The main thing I am trying to understand is this: if an agent is going to participate in email, how do we give it a durable identity boundary that feels simple enough for a real product? Email is not just transport here. It is the interface. A mailbox is the anchor point, and the hosted service is the place where ownership, routing, and sync can be made explicit.

This repository is intentionally rough. It is not polished, not generalized, and not presented as a complete answer. It is an early attempt to connect a few ideas that felt like they belonged together.

## What Agenova is for

Agenova is for people who want to do something active with a mailbox instead of treating it as a passive inbox.

Some example use cases:

- a mailbox for an agent that needs a stable identity and an email boundary
- a workflow inbox for internal tools
- a coordination layer for bots or AI assistants
- a lightweight inbound mail store that syncs back into a local app
- an email backend that can be deployed to your own domain and owned by your own system

The core idea is that a mailbox can be claimed, attached to an owner, and used as a stable coordination point. Once that mailbox is claimed, Agenova keeps the public email boundary separate from your application logic. That makes the system easier to reason about, and it also makes the identity question more concrete: the agent is not just “a process,” it is an actor with a mailbox and a traceable flow.

## What Agenova does

Agenova is split into two parts:

- a hosted API server
- a local application server

The hosted server is the public side. It handles mailbox claims, inbound webhooks, inbox reads, and outbound queuing. This is the service that lives at something like `api.agenova.chat`.

The local server is the product side. It talks to your app, syncs inbound messages, and uses the hosted API to send outbound mail when needed. That separation is deliberate. It keeps the email boundary in one place and keeps your application logic in another.

The current workflow looks like this:

1. A mailbox is claimed through the hosted server.
2. Inbound email arrives at the hosted webhook endpoint.
3. The hosted server stores the message.
4. The local server syncs messages from the hosted inbox.
5. Your app processes the message.
6. If needed, your app sends a reply through the hosted send endpoint.
7. The hosted delivery worker forwards the message through a provider such as Resend or Mailgun.

That gives you a loop that is simple enough to test:

- claim a mailbox
- receive mail
- sync mail
- send mail
- keep the system easy to operate

## Why this exists

A lot of email tooling tends to fall into one of two extremes.

On one side, you have full mail platforms that are powerful but heavy. On the other side, you have simple SMTP setups that are easy to start with but hard to turn into a real workflow. Agenova is trying to sit between those two extremes.

The goal is not to build a giant provider. The goal is to build a narrow, practical coordination layer for projects that need mailbox ownership, inbound capture, sync back into a local database, and outbound delivery.

This project exists because these two ideas fit together well:

- `nit` gives a useful shape for mailbox ownership, coordination, and sync
- `mails` gives a useful shape for handling email in a mailbox-centered flow

Agenova is the rough place where those ideas meet. It is an experiment in making that connection useful for agent identity, not a claim that the problem is already solved.

That is useful for products that need:

- deterministic mailbox ownership
- inbound email capture
- local sync of messages
- outbound email delivery
- a clear hosted/local boundary

Agenova is also being built with AI and automation use cases in mind. A lot of future systems will probably need a mailbox that acts less like a static inbox and more like a structured interface. Agenova is exploring that direction in a simple, deployable way, with the understanding that the identity and trust model is still being worked through.

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

The hosted service is intentionally lightweight. It runs on Bun, uses Hono, and stores state in SQLite. That keeps the deployment simple enough for early usage, while leaving room to expand later if the system grows. At this stage, the architecture is more about proving the shape of the workflow than about presenting a fully hardened production stack.

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

That means the local side can stay focused on product behavior, while the hosted side handles the email boundary and delivery mechanics. In practice, this is the part that makes the project feel useful as an experiment: the agent identity question becomes visible in a real flow instead of staying abstract.

## What you need to set up

At minimum, you will usually need:

- a domain for the email workflow
- hosted infrastructure for `api.agenova.chat`
- inbound routing for email delivery
- an outbound provider such as Resend or Mailgun
- a persistent database for the hosted service
- a local API token so the local server can talk to the hosted one

The exact setup depends on which provider you choose, but the architecture is meant to stay simple. The hosted side is designed to be deployable on common platforms like Fly.io, Railway, or a VPS. The point here is not to require a large setup; it is to make the boundary visible with the least moving parts possible.

## Status

Agenova is still early.

The codebase already covers the main claim, sync, inbound, and outbound flows, but it should still be treated as an evolving system rather than a finished platform. It works as a proof of shape, not as a final answer. There is still a lot left to polish, especially around how durable identity should work for agents over time.

That is intentional. The project is being built in small steps so the system stays understandable and the boundaries stay clear. I would rather have a rough but honest experiment than a polished README that makes the project sound more complete than it is.

## Acknowledgements / Credits

Agenova was inspired by and built with reference to:

- [newtype-ai/nit](https://github.com/newtype-ai/nit)
- [chekusu/mails](https://github.com/chekusu/mails)

I want to be very clear about the relationship here: Agenova is not a copy of either project, and it is not claiming to be the original source of these ideas. I found a useful connection point between them and built an independent implementation around that connection.

`nit` shaped the mailbox coordination and sync side of the system. `mails` shaped the mailbox-first email flow. Agenova exists because those two ideas fit together in a way that felt practical for a hosted/local workflow.

Huge thanks to the original authors for sharing thoughtful open-source work and ideas. Without those projects, Agenova would not have taken this shape.

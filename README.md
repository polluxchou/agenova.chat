# Agenova

Agenova is a rough experiment. I am using it to see if an agent can have a clear email identity that is simple enough to actually use.

The idea did not come from nowhere. It came from two open-source projects:

- [newtype-ai/nit](https://github.com/newtype-ai/nit)
- [chekusu/mails](https://github.com/chekusu/mails)

`nit` gave me the mailbox claim and sync direction. `mails` gave me the mailbox-first email flow direction. Agenova is just my attempt to connect those two ideas into one small system. It is not a copy of either project, and it is not a finished product. It is a rough try.

What I am trying to build is simple:

- claim a mailbox
- receive inbound mail
- sync it into a local app
- send mail back out through a hosted API

That is the basic loop. I want to see if that loop is enough to give an agent a real, usable identity boundary in email.

This is still early. The code works as a sketch of the workflow, but it is not polished. I am not trying to present a complete platform here. I am trying to test whether the shape makes sense.

## What Agenova is for

Agenova is for people who want to do something active with a mailbox instead of treating it like a dead inbox.

Some example use cases:

- a mailbox for an agent that needs a stable identity and an email boundary
- a workflow inbox for internal tools
- a coordination layer for bots or AI assistants
- a lightweight inbound mail store that syncs back into a local app
- an email backend that can be deployed to your own domain and owned by your own system

The main point is that a mailbox can be claimed and tied to an owner. Once that happens, Agenova keeps the public email boundary separate from the app logic. That makes the identity question less vague. The agent is not just a process running somewhere. It has a mailbox, a claim, and a flow.

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

There are a lot of email tools already. Some are too big. Some are too basic. Agenova is my attempt to sit in the middle.

The project exists because these two ideas fit together:

- `nit` gives a useful shape for mailbox ownership, coordination, and sync
- `mails` gives a useful shape for handling email in a mailbox-centered flow

Agenova is the rough place where those ideas meet. I found a connection point and started building from there. I am still testing whether it is actually useful.

That is useful for products that need:

- deterministic mailbox ownership
- inbound email capture
- local sync of messages
- outbound email delivery
- a clear hosted/local boundary

Agenova is also being built with AI and automation use cases in mind. I think a lot of future systems will need a mailbox that is more like an interface than a folder. Agenova is a rough attempt to explore that.

## Current architecture

The current implementation was developed in phases, with the hosted API and local server working together.

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

The hosted service is intentionally lightweight. It runs on Bun, uses Hono, and stores state in SQLite. That is enough for now. The point is to test the shape, not to overbuild.

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

The local side stays focused on product behavior. The hosted side handles the email boundary and delivery mechanics. That is the part I wanted to make visible.

## What you need to set up

At minimum, you will usually need:

- a domain for the email workflow
- hosted infrastructure for `api.agenova.chat`
- inbound routing for email delivery
- an outbound provider such as Resend or Mailgun
- a persistent database for the hosted service
- a local API token so the local server can talk to the hosted one

The exact setup depends on which provider you choose, but the architecture is meant to stay simple. The hosted side is designed to run on common platforms like Fly.io, Railway, or a VPS.

## Status

Agenova is still early.

The codebase already covers the main claim, sync, inbound, and outbound flows, but it should still be treated as an evolving system rather than a finished platform. It works as a rough test, not as a final answer. There is still a lot left to polish.

That is intentional. I would rather keep this README honest than make the project sound more complete than it is.

## Acknowledgements / Credits

Agenova was inspired by and built with reference to:

- [newtype-ai/nit](https://github.com/newtype-ai/nit)
- [chekusu/mails](https://github.com/chekusu/mails)

I want to be clear about the relationship here: Agenova is not a copy of either project, and it is not claiming to be the original source of these ideas. I found a connection point between them and built an independent attempt around that connection.

`nit` shaped the mailbox coordination and sync side of the system. `mails` shaped the mailbox-first email flow. Agenova exists because those two ideas fit together in a way that seemed worth trying.

Huge thanks to the original authors for sharing their work. Without those projects, Agenova would not exist in this form.

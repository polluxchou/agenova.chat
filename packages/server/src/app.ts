// ---------------------------------------------------------------------------
// Agenova — Hono app factory
//
// Separated from index.ts so the app can be imported in tests without
// starting the server or the sync loop.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'

import identityRoutes    from './routes/identity.js'
import deviceRoutes      from './routes/device.js'
import policyRoutes      from './routes/policy.js'
import mailboxRoutes     from './routes/mailbox.js'
import inboundMailRoutes from './routes/inbound-mail.js'
import memoryRoutes      from './routes/memory.js'
import modelKeyRoutes    from './routes/model-keys.js'
import recoveryRoutes    from './routes/recovery.js'

export interface AppOptions {
  enableLogger?: boolean    // default true; disable in tests for cleaner output
}

export function createApp(opts: AppOptions = {}): Hono {
  const app = new Hono()

  if (opts.enableLogger !== false) {
    app.use('*', logger())
  }

  app.use('*', cors({ origin: '*' }))

  // Discovery — no auth (used during LAN pairing)
  app.get('/v1/discovery/info', (c) =>
    c.json({
      node: 'agenova-local',
      version: '0.1.0',
      hostname: process.env.HOSTNAME ?? 'localhost',
    }),
  )

  // ---------------------------------------------------------------------------
  // Route modules
  //
  // Two mailbox namespaces:
  //   /v1/agents/:id/mail/*   → agent-to-agent signed envelopes (local)
  //   /v1/agents/:id/inbox/*  → external email via @agenova.chat (hosted)
  // ---------------------------------------------------------------------------
  app.route('/v1/agents',    identityRoutes)
  app.route('/v1',           deviceRoutes)        // /v1/pairing/*, /v1/devices/*, /v1/agents/:id/devices
  app.route('/v1',           policyRoutes)        // /v1/agents/:id/grants, /v1/policy/check
  app.route('/v1',           mailboxRoutes)       // /v1/mail/*, /v1/agents/:id/mail/*
  app.route('/v1',           inboundMailRoutes)   // /v1/agents/:id/inbox/*, /v1/agents/:id/mailbox/*
  app.route('/v1',           memoryRoutes)        // /v1/agents/:id/memory, /v1/memory/*
  app.route('/v1',           modelKeyRoutes)      // /v1/agents/:id/model-keys/*
  app.route('/v1',           recoveryRoutes)      // /v1/agents/:id/recovery, /v1/recovery/*

  app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

  return app
}

// ---------------------------------------------------------------------------
// Hosted API — Hono app factory
//
// Testable entry point — same pattern as the local server's createApp().
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import claimRoutes from './routes/claim.js'
import inboxRoutes from './routes/inbox.js'
import sendRoutes from './routes/send.js'
import webhookRoutes from './routes/webhook.js'

export function createApp(opts: { enableLogger?: boolean } = {}): Hono {
  const app = new Hono()

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }))

  // Mount routes under /v1
  app.route('/v1', claimRoutes)
  app.route('/v1', inboxRoutes)
  app.route('/v1', sendRoutes)
  app.route('/v1', webhookRoutes)

  return app
}

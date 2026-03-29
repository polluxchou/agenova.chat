// ---------------------------------------------------------------------------
// Hosted API — Server entry point
//
// Runs at api.agenova.chat (or locally for development).
// ---------------------------------------------------------------------------

import { getDb } from './db/client.js'
import { createApp } from './app.js'
import { startMaintenanceLoop } from './maintenance.js'
import { startDeliveryWorker } from './delivery.js'

// Ensure DB is initialized on startup
getDb()

// Start periodic cleanup of expired claim challenges
startMaintenanceLoop()

// Start outbound email delivery worker
startDeliveryWorker()

const app = createApp({ enableLogger: true })
const port = Number(process.env.PORT ?? 3100)

console.log(`[hosted] Agenova Hosted API starting on port ${port}`)
console.log(`[hosted] Mailbox domain: ${process.env.AGENOVA_MAILBOX_DOMAIN ?? 'agenova.chat'}`)

if (process.env.AGENOVA_DEV_TOKEN) {
  console.log(`[hosted] Dev token enabled — use "Bearer ${process.env.AGENOVA_DEV_TOKEN}" for auth`)
}

export default {
  port,
  fetch: app.fetch,
}

// ---------------------------------------------------------------------------
// Agenova v1 — Local Coordination Server entry point
// ---------------------------------------------------------------------------

import { getDb } from './db/client.js'
import { loadOrCreateMasterKey } from './crypto.js'
import { startSyncLoop } from './modules/hosted-sync/index.js'
import { createApp } from './app.js'

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

loadOrCreateMasterKey()
getDb()
startSyncLoop()

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const app = createApp()
const port = Number(process.env.PORT ?? 7700)

console.log(`\n  🤖 Agenova Local Coordination Server`)
console.log(`  Listening on http://localhost:${port}`)
console.log(`  Hosted sync: ${process.env.AGENOVA_API_TOKEN ? 'enabled' : 'disabled (set AGENOVA_API_TOKEN to enable)'}`)
console.log(`  Hosted URL:  ${process.env.AGENOVA_HOSTED_URL ?? 'https://api.agenova.chat (default)'}\n`)

export default {
  port,
  fetch: app.fetch,
}

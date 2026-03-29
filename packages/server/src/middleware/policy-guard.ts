// ---------------------------------------------------------------------------
// Policy guard — inline scope check factory
//
// Usage:
//   router.get('/memory', requireScope('memory.read'), handler)
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import { checkPermission } from '../modules/policy/index.js'

export function requireScope(scope: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const agent_id = c.get('agent_id') as string | undefined

    if (!agent_id) {
      return c.json({ error: 'Not authenticated', code: 'UNAUTHORIZED' }, 401)
    }

    const allowed = checkPermission({ agent_id, scope })
    if (!allowed) {
      return c.json({ error: `Forbidden — scope "${scope}" not granted`, code: 'SCOPE_DENIED' }, 403)
    }

    await next()
  }
}

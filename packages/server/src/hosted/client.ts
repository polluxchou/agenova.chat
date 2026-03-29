// ---------------------------------------------------------------------------
// Hosted API client
//
// All outbound HTTP calls to the hosted @agenova.chat service go through
// this module. The fetch function is injectable for testing.
//
// In production: uses global fetch
// In tests: inject a mock via _setFetch()
// ---------------------------------------------------------------------------

export type FetchFn = typeof globalThis.fetch

let _fetch: FetchFn = globalThis.fetch

/**
 * Inject a custom fetch implementation (for tests).
 * Pass undefined to restore the real fetch.
 */
export function _setFetch(fn?: FetchFn): void {
  _fetch = fn ?? globalThis.fetch
}

export function getFetch(): FetchFn {
  return _fetch
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getHostedBaseUrl(): string {
  return process.env.AGENOVA_HOSTED_URL ?? 'https://api.agenova.chat'
}

export function getMailboxDomain(): string {
  return process.env.AGENOVA_MAILBOX_DOMAIN ?? 'agenova.chat'
}

export function getApiToken(): string | undefined {
  return process.env.AGENOVA_API_TOKEN
}

// ---------------------------------------------------------------------------
// Request helpers with retry
// ---------------------------------------------------------------------------

export interface HostedRequestOptions {
  method: string
  path: string
  body?: unknown
  token?: string
  retries?: number         // default 2
  retryDelayMs?: number    // default 1000, doubles each retry
}

export interface HostedResponse<T = unknown> {
  ok: boolean
  status: number
  data: T
}

/**
 * Make a request to the hosted service with optional retry + exponential backoff.
 * Retries only on 5xx or network errors, never on 4xx.
 */
export async function hostedRequest<T = unknown>(
  opts: HostedRequestOptions,
): Promise<HostedResponse<T>> {
  const baseUrl = getHostedBaseUrl()
  const url = `${baseUrl}${opts.path}`
  const maxRetries = opts.retries ?? 2
  const baseDelay = opts.retryDelayMs ?? 1000

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await _fetch(url, {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })

      const data = await res.json().catch(() => null) as T

      if (res.ok || (res.status >= 400 && res.status < 500)) {
        // Success or client error — do not retry
        return { ok: res.ok, status: res.status, data }
      }

      // 5xx — retry
      lastError = new Error(`Hosted service returned ${res.status}`)
    } catch (err) {
      // Network error — retry
      lastError = err instanceof Error ? err : new Error(String(err))
    }

    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, delay))
    }
  }

  throw lastError ?? new Error('Hosted request failed after retries')
}

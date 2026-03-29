// ---------------------------------------------------------------------------
// Outbound email delivery worker
//
// Reads rows from `outbound_queue` with status='queued', dispatches them via
// the configured email provider, and updates status to 'sent' or 'failed'.
//
// Provider selection (AGENOVA_EMAIL_PROVIDER env var):
//   "resend"   — Resend API (default)  — requires RESEND_API_KEY
//   "mailgun"  — Mailgun API           — requires MAILGUN_API_KEY + MAILGUN_DOMAIN
//
// Tuning:
//   AGENOVA_DELIVERY_INTERVAL_MS   — poll interval (default: 30 000 ms)
//   AGENOVA_DELIVERY_BATCH_SIZE    — rows per tick  (default: 10)
// ---------------------------------------------------------------------------

import { dbAll, dbRun } from './db/client.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutboundJob {
  id: string
  from_mailbox: string
  to_addresses: string    // raw JSON stored in DB: '["a@b.com","c@d.com"]'
  subject: string
  body_text: string
  body_html: string
  headers: string         // raw JSON
  status: string
  created_at: string
}

export interface DeliveryResult {
  ok: boolean
  error?: string
}

export interface EmailProvider {
  name: string
  send(job: OutboundJob): Promise<DeliveryResult>
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getQueuedJobs(batchSize: number): OutboundJob[] {
  return dbAll<OutboundJob>(
    `SELECT * FROM outbound_queue WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
    batchSize,
  )
}

function markSending(id: string): void {
  dbRun(
    `UPDATE outbound_queue SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'`,
    new Date().toISOString(), id,
  )
}

function markSent(id: string): void {
  dbRun(
    `UPDATE outbound_queue SET status = 'sent', updated_at = ? WHERE id = ?`,
    new Date().toISOString(), id,
  )
}

function markFailed(id: string, error: string): void {
  dbRun(
    `UPDATE outbound_queue SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
    error.slice(0, 512), new Date().toISOString(), id,
  )
}

// Reset 'sending' rows that were orphaned (e.g. process crash) back to 'queued'
// so they can be retried on the next startup.
export function resetStuckJobs(): void {
  dbRun(
    `UPDATE outbound_queue SET status = 'queued', updated_at = ? WHERE status = 'sending'`,
    new Date().toISOString(),
  )
}

// ---------------------------------------------------------------------------
// Resend provider  (https://resend.com/docs/api-reference/emails/send-email)
// ---------------------------------------------------------------------------

export class ResendProvider implements EmailProvider {
  readonly name = 'resend'
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(apiKey: string, baseUrl = 'https://api.resend.com') {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  async send(job: OutboundJob): Promise<DeliveryResult> {
    const to: string[] = JSON.parse(job.to_addresses)

    const res = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: job.from_mailbox,
        to,
        subject: job.subject,
        text: job.body_text || undefined,
        html: job.body_html || undefined,
      }),
    })

    if (res.ok) {
      return { ok: true }
    }

    const body = await res.text().catch(() => `HTTP ${res.status}`)
    return { ok: false, error: `Resend error ${res.status}: ${body.slice(0, 256)}` }
  }
}

// ---------------------------------------------------------------------------
// Mailgun provider  (https://documentation.mailgun.com/en/latest/api-sending.html)
// ---------------------------------------------------------------------------

export class MailgunProvider implements EmailProvider {
  readonly name = 'mailgun'
  private readonly apiKey: string
  private readonly domain: string
  private readonly baseUrl: string

  constructor(apiKey: string, domain: string, baseUrl = 'https://api.mailgun.net') {
    this.apiKey = apiKey
    this.domain = domain
    this.baseUrl = baseUrl
  }

  async send(job: OutboundJob): Promise<DeliveryResult> {
    const to: string[] = JSON.parse(job.to_addresses)

    const form = new URLSearchParams()
    form.set('from', job.from_mailbox)
    form.set('to', to.join(','))
    form.set('subject', job.subject)
    if (job.body_text) form.set('text', job.body_text)
    if (job.body_html) form.set('html', job.body_html)

    const creds = Buffer.from(`api:${this.apiKey}`).toString('base64')
    const res = await fetch(`${this.baseUrl}/v3/${this.domain}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })

    if (res.ok) {
      return { ok: true }
    }

    const body = await res.text().catch(() => `HTTP ${res.status}`)
    return { ok: false, error: `Mailgun error ${res.status}: ${body.slice(0, 256)}` }
  }
}

// ---------------------------------------------------------------------------
// Provider factory — reads env vars
// ---------------------------------------------------------------------------

export function createProvider(): EmailProvider | null {
  const providerName = (process.env.AGENOVA_EMAIL_PROVIDER ?? 'resend').toLowerCase()

  if (providerName === 'resend') {
    const key = process.env.RESEND_API_KEY
    if (!key) return null
    return new ResendProvider(key)
  }

  if (providerName === 'mailgun') {
    const key    = process.env.MAILGUN_API_KEY
    const domain = process.env.MAILGUN_DOMAIN
    if (!key || !domain) return null
    return new MailgunProvider(key, domain)
  }

  return null
}

// ---------------------------------------------------------------------------
// Delivery loop
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS  = 30_000
const DEFAULT_BATCH_SIZE   = 10

let _deliveryTimer: ReturnType<typeof setInterval> | null = null

export function startDeliveryWorker(
  provider?: EmailProvider,
  intervalMs  = Number(process.env.AGENOVA_DELIVERY_INTERVAL_MS)  || DEFAULT_INTERVAL_MS,
  batchSize   = Number(process.env.AGENOVA_DELIVERY_BATCH_SIZE)   || DEFAULT_BATCH_SIZE,
): void {
  if (_deliveryTimer) return

  const resolvedProvider = provider ?? createProvider()

  if (!resolvedProvider) {
    console.warn(
      '[hosted] delivery: no email provider configured — ' +
      'set AGENOVA_EMAIL_PROVIDER (resend|mailgun) and the matching API key env var. ' +
      'Outbound queue will not be processed.',
    )
    return
  }

  // On startup, rescue any orphaned 'sending' rows from a previous crashed process
  resetStuckJobs()
  console.log(`[hosted] delivery: worker started (provider=${resolvedProvider.name}, interval=${intervalMs}ms)`)

  // Run one tick immediately, then on interval
  _runDeliveryTick(resolvedProvider, batchSize)
  _deliveryTimer = setInterval(() => _runDeliveryTick(resolvedProvider, batchSize), intervalMs)
}

export function _resetDeliveryWorker(): void {
  if (_deliveryTimer) {
    clearInterval(_deliveryTimer)
    _deliveryTimer = null
  }
}

async function _runDeliveryTick(provider: EmailProvider, batchSize: number): Promise<void> {
  const jobs = getQueuedJobs(batchSize)
  if (jobs.length === 0) return

  console.log(`[hosted] delivery: processing ${jobs.length} queued email(s)`)

  for (const job of jobs) {
    // Optimistic lock — skip if another worker grabbed it
    markSending(job.id)

    try {
      const result = await provider.send(job)
      if (result.ok) {
        markSent(job.id)
        console.log(`[hosted] delivery: sent ${job.id} to ${job.to_addresses}`)
      } else {
        markFailed(job.id, result.error ?? 'Unknown error')
        console.error(`[hosted] delivery: failed ${job.id}: ${result.error}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      markFailed(job.id, msg)
      console.error(`[hosted] delivery: exception for ${job.id}: ${msg}`)
    }
  }
}

// ---------------------------------------------------------------------------
// For testing — process a single tick synchronously against a given provider
// ---------------------------------------------------------------------------

export async function runDeliveryTick(
  provider: EmailProvider,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<void> {
  return _runDeliveryTick(provider, batchSize)
}

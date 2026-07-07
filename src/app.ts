import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { parseDomain } from './lib/parse'
import { checkEmail, checkDomain } from './lib/check'
import { handleMcpMessage, MCP_PARSE_ERROR } from './mcp-http'
import type { Dataset } from './lib/classify'
import type { Changelog } from './data'

const MAX_BATCH = 100
// The changelog retains 90 days; don't pretend to answer beyond it.
const MAX_SINCE_MS = 90 * 86_400_000
// Hard cap per category so a wide window can't produce a megabyte response.
const MAX_FEED_DOMAINS = 5000

/** Accepts "24h" / "7d" relative forms or an ISO 8601 timestamp. */
function parseSince(raw: string): Date | null {
  const rel = raw.match(/^(\d+)([hd])$/)
  if (rel) {
    const n = Number(rel[1])
    if (n <= 0) return null
    return new Date(Date.now() - n * (rel[2] === 'h' ? 3_600_000 : 86_400_000))
  }
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : new Date(t)
}

export function createApp(ds: Dataset, changelog?: Changelog) {
  const app = new Hono()
  app.use('*', cors())

  app.get('/', c =>
    c.json({
      service: 'mailverdict',
      dataset_version: ds.version,
      docs: '/llms.txt',
      openapi: '/openapi.yaml',
      endpoints: ['/v1/check?email=', '/v1/check/{email}', 'POST /v1/check (batch)', '/v1/domain/{domain}', '/v1/changes?since=24h', '/v1/meta'],
      mcp: 'POST /mcp (keyless remote MCP server; tools: check_email, check_domain)',
      note: 'Free. No API key required.',
      contact: 'hello@mailverdict.dev — higher limits, SLA, or commercial use'
    })
  )

  app.get('/v1/meta', c =>
    c.json({
      dataset_version: ds.version,
      disposable_domains: ds.disposable.size,
      free_provider_domains: ds.freeProviders.size,
      role_local_parts: ds.roles.size
    })
  )

  app.get('/v1/check', async c => {
    const email = c.req.query('email')
    if (!email) return c.json({ error: { code: 'missing_parameter', message: 'email query parameter is required' } }, 400)
    // Query-string decoding turns "+" into a space; spaces are never valid in
    // the addresses we accept, so restore the "+" for unencoded plus-tags.
    return c.json(await checkEmail(email.replaceAll(' ', '+'), ds, c.req.query('mx') !== 'false'))
  })

  app.get('/v1/check/:email', async c =>
    c.json(await checkEmail(decodeURIComponent(c.req.param('email')), ds, c.req.query('mx') !== 'false'))
  )

  app.post('/v1/check', async c => {
    let body: { emails?: unknown; mx?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { code: 'invalid_json', message: 'body must be valid JSON' } }, 400)
    }
    if (!Array.isArray(body.emails) || body.emails.length === 0) {
      return c.json({ error: { code: 'invalid_body', message: 'body must be {"emails": ["a@b.com", ...]}' } }, 400)
    }
    if (body.emails.length > MAX_BATCH) {
      return c.json({ error: { code: 'batch_too_large', message: `max ${MAX_BATCH} emails per batch` } }, 400)
    }
    const withMx = body.mx !== false
    const results = await Promise.all(body.emails.map(e => checkEmail(String(e), ds, withMx)))
    return c.json({ results })
  })

  app.get('/v1/domain/:domain', async c => {
    const { valid, domain } = parseDomain(decodeURIComponent(c.req.param('domain')))
    if (!valid || !domain) return c.json({ error: { code: 'invalid_domain', message: 'not a valid domain' } }, 400)
    return c.json(await checkDomain(domain, ds, c.req.query('mx') !== 'false'))
  })

  // Freshness feed: domains added/removed since a point in time, so callers
  // can audit dataset recency or keep a local mirror current.
  app.get('/v1/changes', c => {
    const raw = c.req.query('since') ?? '24h'
    const since = parseSince(raw)
    if (!since) {
      return c.json({ error: { code: 'invalid_since', message: 'since must be ISO 8601 or a relative form like 24h / 7d' } }, 400)
    }
    let sinceIso = since.toISOString()
    let note: string | null = null
    const floor = new Date(Date.now() - MAX_SINCE_MS).toISOString()
    if (sinceIso < floor) {
      sinceIso = floor
      note = 'since clamped to the 90-day retention window'
    }

    // Net-apply entries in chronological order so a domain added then removed
    // inside the window reports its final state only.
    const added = { disposable: new Set<string>(), free_providers: new Set<string>() }
    const removed = { disposable: new Set<string>(), free_providers: new Set<string>() }
    for (const e of changelog?.entries ?? []) {
      if (e.at <= sinceIso) continue
      for (const kind of ['disposable', 'free_providers'] as const) {
        for (const d of e.added[kind]) { added[kind].add(d); removed[kind].delete(d) }
        for (const d of e.removed[kind]) { removed[kind].add(d); added[kind].delete(d) }
      }
    }
    const cap = (s: Set<string>) => [...s].sort().slice(0, MAX_FEED_DOMAINS)
    const truncated = [...Object.values(added), ...Object.values(removed)].some(s => s.size > MAX_FEED_DOMAINS)
    if (!changelog) note = 'changelog not yet available on this deployment; the feed accumulates from daily dataset builds'

    return c.json({
      dataset_version: ds.version,
      since: sinceIso,
      feed_updated_at: changelog?.updated_at ?? null,
      added: { disposable: cap(added.disposable), free_providers: cap(added.free_providers) },
      removed: { disposable: cap(removed.disposable), free_providers: cap(removed.free_providers) },
      counts: {
        added: added.disposable.size + added.free_providers.size,
        removed: removed.disposable.size + removed.free_providers.size
      },
      ...(truncated ? { truncated: true } : {}),
      ...(note ? { note } : {})
    })
  })

  // Keyless remote MCP server (stateless Streamable HTTP). Agents POST
  // JSON-RPC here to discover and call the check_email / check_domain tools.
  app.post('/mcp', async c => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(MCP_PARSE_ERROR, 400)
    }
    const response = await handleMcpMessage(body, ds)
    // Notifications only -> nothing to send.
    if (response === null) return c.body(null, 202)
    return c.json(response)
  })

  // This server is stateless and does not offer a server-to-client SSE stream,
  // so the GET half of the Streamable HTTP transport is unsupported.
  app.get('/mcp', c =>
    c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'This MCP server is stateless; use JSON-RPC over POST. GET/SSE is not supported.' } }, 405)
  )

  return app
}

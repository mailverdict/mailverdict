import { describe, expect, it } from 'vitest'
import { parseEmail, parseDomain } from '../src/lib/parse'
import { classifyEmail, classifyDomain, matchDomain, suggestDomain, type Dataset } from '../src/lib/classify'
import { checkEmail } from '../src/lib/check'
import type { Changelog } from '../src/data'

const ds: Dataset = {
  version: 'test',
  // gmaill.com: disposable typo-squat; gmial.com: typo-squat that the
  // upstream free-provider list (wrongly, for our purposes) includes.
  disposable: new Set(['mailinator.com', 'tempmail.dev', 'gmaill.com']),
  freeProviders: new Set(['gmail.com', 'yahoo.com', 'gmial.com']),
  roles: new Set(['admin', 'info', 'support'])
}

describe('parseEmail', () => {
  it('accepts a normal address', () => {
    const p = parseEmail('Jane.Doe@Example.COM')
    expect(p.valid).toBe(true)
    expect(p.domain).toBe('example.com')
    expect(p.canonical).toBe('jane.doe@example.com')
  })

  it('extracts plus tags', () => {
    const p = parseEmail('jane+newsletter@example.com')
    expect(p.tag).toBe('newsletter')
    expect(p.canonical).toBe('jane@example.com')
  })

  it('collapses gmail dots in canonical form', () => {
    const p = parseEmail('j.a.n.e+x@gmail.com')
    expect(p.canonical).toBe('jane@gmail.com')
  })

  it('rejects malformed addresses', () => {
    expect(parseEmail('not-an-email').valid).toBe(false)
    expect(parseEmail('@example.com').valid).toBe(false)
    expect(parseEmail('a@').valid).toBe(false)
    expect(parseEmail('a..b@example.com').valid).toBe(false)
    expect(parseEmail('.a@example.com').valid).toBe(false)
    expect(parseEmail(`${'x'.repeat(65)}@example.com`).valid).toBe(false)
    expect(parseEmail('a@no-tld').valid).toBe(false)
  })
})

describe('matchDomain', () => {
  it('matches exact and parent domains', () => {
    expect(matchDomain('mailinator.com', ds.disposable)).toBe('mailinator.com')
    expect(matchDomain('foo.mailinator.com', ds.disposable)).toBe('mailinator.com')
    expect(matchDomain('a.b.mailinator.com', ds.disposable)).toBe('mailinator.com')
    expect(matchDomain('example.com', ds.disposable)).toBeNull()
  })
})

describe('classifyEmail', () => {
  it('flags disposable domains', () => {
    const c = classifyEmail(parseEmail('x@foo.mailinator.com'), ds)!
    expect(c.disposable).toBe(true)
    expect(c.disposable_match).toBe('mailinator.com')
  })

  it('role detection ignores plus tags and case', () => {
    const c = classifyEmail(parseEmail('Support+ticket@example.com'), ds)!
    expect(c.role_account).toBe(true)
  })

  it('classifies free providers', () => {
    const c = classifyEmail(parseEmail('jane@gmail.com'), ds)!
    expect(c.free_provider).toBe(true)
    expect(c.disposable).toBe(false)
  })
})

describe('suggestDomain', () => {
  it('suggests corrections for close typos', () => {
    expect(suggestDomain('gmial.com')).toBe('gmail.com')
    expect(suggestDomain('gmail.con')).toBe('gmail.com')
    expect(suggestDomain('outlok.com')).toBe('outlook.com')
  })

  it('does not fire on popular domains or distant strings', () => {
    expect(suggestDomain('gmail.com')).toBeNull()
    expect(suggestDomain('mycompany.io')).toBeNull()
  })

  it('is not suggested for known distinct providers', () => {
    const c = classifyDomain('yahoo.com', ds)
    expect(c.did_you_mean).toBeNull()
  })

  it('still fires for typo-squats that sit on the free-provider list', () => {
    const c = classifyDomain('gmial.com', ds)
    expect(c.free_provider).toBe(true)
    expect(c.did_you_mean).toBe('gmail.com')
  })

  it('never fires for disposable domains', () => {
    const c = classifyDomain('gmaill.com', ds)
    expect(c.disposable).toBe(true)
    expect(c.did_you_mean).toBeNull()
  })
})

describe('checkEmail (mx disabled — no network in tests)', () => {
  it('marks disposable as risky with the conventional reason', async () => {
    const r = await checkEmail('jane@tempmail.dev', ds, false)
    expect(r.result).toBe('risky')
    expect(r.reason).toBe('disposable_email')
    expect(r.disposable).toBe(true)
    expect(r.score).toBeLessThan(10)
  })

  it('marks invalid syntax as undeliverable with score 0', async () => {
    const r = await checkEmail('nope', ds, false)
    expect(r.result).toBe('undeliverable')
    expect(r.reason).toBe('invalid_email')
    expect(r.valid_syntax).toBe(false)
    expect(r.score).toBe(0)
  })

  it('marks role accounts as risky', async () => {
    const r = await checkEmail('admin@example.com', ds, false)
    expect(r.result).toBe('risky')
    expect(r.reason).toBe('role_email')
    expect(r.role).toBe(true)
  })

  it('returns a full corrected address in did_you_mean', async () => {
    const r = await checkEmail('bob@gmial.com', ds, false)
    expect(r.did_you_mean).toBe('bob@gmail.com')
    expect(r.result).toBe('risky')
    expect(r.reason).toBe('possible_typo')
  })

  it('passes clean addresses as deliverable with null mx_found', async () => {
    const r = await checkEmail('jane.doe+tag@bigcorp.com', ds, false)
    expect(r.result).toBe('deliverable')
    expect(r.reason).toBe('accepted_email')
    expect(r.mx_found).toBeNull()
    expect(r.normalized_email).toBe('jane.doe@bigcorp.com')
    expect(r.tag).toBe('tag')
    expect(r.accept_all).toBeNull()
  })
})

describe('HTTP layer', () => {
  it('restores "+" that query-string decoding turned into a space', async () => {
    const { createApp } = await import('../src/app')
    const app = createApp(ds)
    // curl "…?email=jane.doe+news@example.com" reaches the handler as a space
    const res = await app.request('/v1/check?email=jane.doe+news@example.com&mx=false')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valid_syntax).toBe(true)
    expect(body.tag).toBe('news')
    expect(body.normalized_email).toBe('jane.doe@example.com')
  })
})

describe('parseDomain', () => {
  it('normalizes URLs to bare domains', () => {
    expect(parseDomain('https://Example.com/path').domain).toBe('example.com')
    expect(parseDomain('example.com').domain).toBe('example.com')
    expect(parseDomain('not a domain').valid).toBe(false)
  })
})

describe('/v1/changes feed', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const empty = { disposable: [] as string[], free_providers: [] as string[] }
  const changelog: Changelog = {
    updated_at: hoursAgo(1),
    entries: [
      // Old entry (outside a 24h window): a burner added 3 days ago, and
      // rescued.com wrongly added (it gets removed again in the recent entry).
      {
        at: hoursAgo(72),
        version: 'old',
        added: { disposable: ['old-burner.com', 'rescued.com'], free_providers: [] },
        removed: empty
      },
      // Recent entry (inside 24h): fresh burner + a free provider, rescue of rescued.com.
      {
        at: hoursAgo(2),
        version: 'new',
        added: { disposable: ['fresh-burner.com'], free_providers: ['newmail.example'] },
        removed: { disposable: ['rescued.com'], free_providers: [] }
      }
    ]
  }

  const appWith = async (log?: Changelog) => {
    const { createApp } = await import('../src/app')
    return createApp(ds, log)
  }

  it('serves only changes inside the window', async () => {
    const app = await appWith(changelog)
    const res = await app.request('/v1/changes?since=24h')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.added.disposable).toEqual(['fresh-burner.com'])
    expect(body.added.free_providers).toEqual(['newmail.example'])
    expect(body.removed.disposable).toEqual(['rescued.com'])
    expect(body.counts).toEqual({ added: 2, removed: 1 })
    expect(body.feed_updated_at).toBe(changelog.updated_at)
  })

  it('net-applies add-then-remove across a wide window', async () => {
    const app = await appWith(changelog)
    const res = await app.request('/v1/changes?since=7d')
    const body = await res.json()
    // rescued.com was added then removed inside the window — final state only.
    expect(body.added.disposable).toEqual(['fresh-burner.com', 'old-burner.com'])
    expect(body.removed.disposable).toEqual(['rescued.com'])
  })

  it('accepts ISO timestamps and rejects junk', async () => {
    const app = await appWith(changelog)
    const iso = await app.request(`/v1/changes?since=${encodeURIComponent(hoursAgo(24))}`)
    expect(iso.status).toBe(200)
    const bad = await app.request('/v1/changes?since=yesterday-ish')
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.code).toBe('invalid_since')
  })

  it('clamps windows beyond retention and notes it', async () => {
    const app = await appWith(changelog)
    const body = await (await app.request('/v1/changes?since=365d')).json()
    expect(body.note).toContain('clamped')
  })

  it('degrades gracefully with no changelog', async () => {
    const app = await appWith(undefined)
    const body = await (await app.request('/v1/changes')).json()
    expect(body.added.disposable).toEqual([])
    expect(body.feed_updated_at).toBeNull()
    expect(body.note).toContain('not yet available')
  })
})

describe('remote MCP server (/mcp)', () => {
  const rpc = async (body: unknown) => {
    const { createApp } = await import('../src/app')
    const app = createApp(ds)
    return app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  it('handshakes on initialize and advertises tools capability', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.serverInfo.name).toBe('mailverdict')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.protocolVersion).toBe('2025-06-18')
  })

  it('lists check_email and check_domain with input schemas', async () => {
    const body = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const names = body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['check_email', 'check_domain'])
    expect(body.result.tools[0].inputSchema.required).toEqual(['email'])
  })

  it('calls check_email and returns the check as tool text', async () => {
    const body = await (await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'check_email', arguments: { email: 'jane@mailinator.com', mx: false } }
    })).json()
    const payload = JSON.parse(body.result.content[0].text)
    expect(payload.disposable).toBe(true)
    expect(payload.result).toBe('risky')
    expect(body.result.isError).toBeUndefined()
  })

  it('calls check_domain', async () => {
    const body = await (await rpc({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'check_domain', arguments: { domain: 'gmail.com', mx: false } }
    })).json()
    const payload = JSON.parse(body.result.content[0].text)
    expect(payload.free).toBe(true)
  })

  it('flags a bad tool argument as an isError result, not a protocol error', async () => {
    const body = await (await rpc({
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'check_email', arguments: {} }
    })).json()
    expect(body.result.isError).toBe(true)
  })

  it('returns JSON-RPC errors for unknown method and unknown tool', async () => {
    const unknownMethod = await (await rpc({ jsonrpc: '2.0', id: 6, method: 'no/such' })).json()
    expect(unknownMethod.error.code).toBe(-32601)
    const unknownTool = await (await rpc({
      jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope', arguments: {} }
    })).json()
    expect(unknownTool.error.code).toBe(-32602)
  })

  it('accepts notifications with 202 and no body', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('rejects a GET with 405 (stateless: no SSE stream)', async () => {
    const { createApp } = await import('../src/app')
    const res = await createApp(ds).request('/mcp')
    expect(res.status).toBe(405)
  })
})

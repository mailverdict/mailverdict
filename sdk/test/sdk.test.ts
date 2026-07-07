import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serve, type ServerType } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { createApp } from '../../src/app'
import type { Dataset } from '../../src/lib/classify'
import { createClient, SNAPSHOT_VERSION } from '../src/index'

// Live path: a real HTTP server running the actual app, on an ephemeral port.
const ds: Dataset = {
  version: 'sdk-live-test',
  disposable: new Set(['livetest-burner.example']),
  freeProviders: new Set(['gmail.com']),
  roles: new Set(['admin'])
}

let server: ServerType
let liveUrl: string
// Nothing listens here — connection refused, exercising the fallback path.
const deadUrl = 'http://127.0.0.1:9'

beforeAll(async () => {
  server = serve({ fetch: createApp(ds).fetch, port: 0 })
  await new Promise<void>(resolve => server.on('listening', () => resolve()))
  liveUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))))

describe('createClient — live path', () => {
  it('returns API results tagged source:live', async () => {
    const client = createClient({ baseUrl: liveUrl })
    const r = await client.checkEmail('jane@livetest-burner.example', { mx: false })
    expect(r.source).toBe('live')
    expect(r.disposable).toBe(true)
    expect(r.result).toBe('risky')
  })

  it('checkDomain works on the live path', async () => {
    const client = createClient({ baseUrl: liveUrl })
    const r = await client.checkDomain('livetest-burner.example', { mx: false })
    expect(r.source).toBe('live')
    expect(r.disposable).toBe(true)
  })
})

describe('createClient — snapshot fallback', () => {
  it('falls back to the bundled snapshot when the API is unreachable', async () => {
    const client = createClient({ baseUrl: deadUrl, timeoutMs: 750 })
    // mailinator.com comes from the real generated snapshot, not a fixture.
    const r = await client.checkEmail('jane@mailinator.com')
    expect(r.source).toBe('snapshot')
    expect(r.disposable).toBe(true)
    expect(r.disposable_match).toBe('mailinator.com')
    expect(r.mx_found).toBeNull() // snapshot mode never does network MX
  })

  it('keeps the industry response shape offline', async () => {
    const client = createClient({ mode: 'snapshot' })
    const r = await client.checkEmail('admin@bigcorp.example')
    expect(r.source).toBe('snapshot')
    expect(r.result).toBe('risky')
    expect(r.reason).toBe('role_email')
    expect(r.normalized_email).toBe('admin@bigcorp.example')
  })

  it('checkDomain falls back and validates input', async () => {
    const client = createClient({ baseUrl: deadUrl, timeoutMs: 750 })
    const r = await client.checkDomain('mailinator.com')
    expect(r.source).toBe('snapshot')
    expect(r.disposable).toBe(true)
    await expect(client.checkDomain('not a domain')).rejects.toThrow(/not a valid domain/)
  })

  it('mode:live throws instead of falling back', async () => {
    const client = createClient({ baseUrl: deadUrl, timeoutMs: 750, mode: 'live' })
    await expect(client.checkEmail('jane@mailinator.com')).rejects.toThrow()
  })

  it('exposes the snapshot version', () => {
    expect(SNAPSHOT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

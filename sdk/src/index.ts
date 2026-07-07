// mailverdict SDK: living data with a static safety net.
//
// checkEmail/checkDomain call the live API (freshest dataset, MX, full
// response) and fall back to a bundled offline snapshot when the API is
// unreachable, slow, or erroring. The fallback makes this strictly better
// than both existing options: fresher than a vendored static list, and —
// unlike a bare API call — never a hard runtime dependency in your signup path.
import snapshot from './snapshot.json'
import { checkEmail as offlineCheckEmail, checkDomain as offlineCheckDomain } from './vendor/check'
import type { EmailCheck, DomainCheck } from './vendor/check'
import { parseDomain } from './vendor/parse'
import type { Dataset } from './vendor/classify'

export const DEFAULT_BASE_URL = 'https://api.mailverdict.dev'

export interface ClientOptions {
  /** API origin. Defaults to the hosted service. */
  baseUrl?: string
  /** Per-request budget before falling back to the snapshot. Default 2000. */
  timeoutMs?: number
  /**
   * auto (default): live API, snapshot fallback on any failure.
   * live: API only — failures throw (choose this when you must have MX/freshest data).
   * snapshot: offline only — never touches the network (no PII leaves the process).
   */
  mode?: 'auto' | 'live' | 'snapshot'
}

export interface CheckOptions {
  /** Set false to skip the MX lookup on the live path. Snapshot mode never does MX. */
  mx?: boolean
}

export type EmailResult = EmailCheck & { source: 'live' | 'snapshot' }
export type DomainResult = DomainCheck & { source: 'live' | 'snapshot' }
export type { EmailCheck, DomainCheck }

let cachedDataset: Dataset | null = null
function snapshotDataset(): Dataset {
  cachedDataset ??= {
    version: snapshot.version,
    disposable: new Set(snapshot.disposable),
    freeProviders: new Set(snapshot.free_providers),
    roles: new Set(snapshot.roles)
  }
  return cachedDataset
}

/** Version of the bundled offline snapshot (the live API reports its own via /v1/meta). */
export const SNAPSHOT_VERSION: string = snapshot.version

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? 2000
  const mode = options.mode ?? 'auto'

  async function live<T>(path: string): Promise<T & { source: 'live' }> {
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`mailverdict API responded ${res.status}`)
    return { ...((await res.json()) as T), source: 'live' as const }
  }

  return {
    async checkEmail(email: string, o: CheckOptions = {}): Promise<EmailResult> {
      const mx = o.mx !== false
      if (mode !== 'snapshot') {
        try {
          return await live<EmailCheck>(`/v1/check?email=${encodeURIComponent(email)}&mx=${mx}`)
        } catch (err) {
          if (mode === 'live') throw err
        }
      }
      // Offline: bundled snapshot, MX skipped — deterministic, zero network.
      return { ...(await offlineCheckEmail(email, snapshotDataset(), false)), source: 'snapshot' }
    },

    async checkDomain(domain: string, o: CheckOptions = {}): Promise<DomainResult> {
      const mx = o.mx !== false
      if (mode !== 'snapshot') {
        try {
          return await live<DomainCheck>(`/v1/domain/${encodeURIComponent(domain)}?mx=${mx}`)
        } catch (err) {
          if (mode === 'live') throw err
        }
      }
      const parsed = parseDomain(domain)
      if (!parsed.valid || !parsed.domain) throw new Error(`not a valid domain: ${domain}`)
      return { ...(await offlineCheckDomain(parsed.domain, snapshotDataset(), false)), source: 'snapshot' }
    }
  }
}

export type Client = ReturnType<typeof createClient>

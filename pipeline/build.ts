import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCES, type Source } from './sources'
import { ROLE_LOCAL_PARTS } from './roles'
import type { Changelog, RawDataset } from '../src/data'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
// The freshness feed only serves 90 days back; prune older entries on write.
const CHANGELOG_RETENTION_DAYS = 90

// Conservative shape checks — anything that fails is skipped and counted,
// not fatal, because upstream lists occasionally contain junk lines.
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
const LOCAL_PART_RE = /^[a-z0-9][a-z0-9._+-]{0,63}$/

interface SourceResult {
  name: string
  kind: Source['kind']
  url: string
  license: string
  repo: string
  status: 'ok' | 'failed'
  count: number
  skipped: number
  error?: string
}

async function fetchText(url: string, retries = 2): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw lastErr
}

function parseList(text: string, format: Source['format'], kind: Source['kind']): { entries: string[]; skipped: number } {
  let candidates: string[]
  if (format === 'json') {
    candidates = JSON.parse(text) as string[]
  } else if (format === 'js-strings') {
    // Extract quoted string literals from a JS source file (the mixmaxhq role
    // list is categorized JS arrays, not a plain list).
    candidates = [...text.matchAll(/['"]([A-Za-z0-9._+-]{2,64})['"]/g)].map(m => m[1])
  } else {
    candidates = text.split('\n')
  }
  const shape = kind === 'role' ? LOCAL_PART_RE : DOMAIN_RE
  const entries: string[] = []
  let skipped = 0
  for (const raw of candidates) {
    const line = String(raw).trim().toLowerCase()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    if (shape.test(line)) entries.push(line)
    else skipped++
  }
  return { entries, skipped }
}

async function loadSource(source: Source): Promise<{ result: SourceResult; domains: Set<string> }> {
  const base: Omit<SourceResult, 'status' | 'count' | 'skipped'> = {
    name: source.name, kind: source.kind, url: source.url,
    license: source.license, repo: source.repo
  }
  try {
    let text: string
    try {
      text = await fetchText(source.url)
    } catch (err) {
      if (!source.fallbackUrl) throw err
      text = await fetchText(source.fallbackUrl)
    }
    const { entries, skipped } = parseList(text, source.format, source.kind)
    if (entries.length === 0) throw new Error('parsed zero entries — format change upstream?')
    console.log(`  ok      ${source.name}: ${entries.length} entries (${skipped} lines skipped)`)
    return { result: { ...base, status: 'ok', count: entries.length, skipped }, domains: new Set(entries) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`  FAILED  ${source.name}: ${message}`)
    return { result: { ...base, status: 'failed', count: 0, skipped: 0, error: message }, domains: new Set() }
  }
}

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function diffLists(prev: string[], next: Set<string>): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev)
  return {
    added: [...next].filter(d => !prevSet.has(d)).sort(),
    removed: prev.filter(d => !next.has(d)).sort()
  }
}

async function main() {
  console.log(`Building dataset from ${SOURCES.length} sources...`)
  // Snapshot the previous build BEFORE overwriting — the changelog diff needs it.
  const prevDataset = readJsonIfExists<RawDataset>(join(OUT_DIR, 'dataset.json'))
  const prevMeta = readJsonIfExists<{ sources: { status: string }[] }>(join(OUT_DIR, 'meta.json'))
  const loaded = await Promise.all(SOURCES.map(loadSource))
  const results = loaded.map(l => l.result)

  const okDisposable = results.filter(r => r.kind === 'disposable' && r.status === 'ok')
  if (okDisposable.length === 0) {
    console.error('All disposable sources failed — refusing to write an empty dataset.')
    process.exit(1)
  }

  const disposable = new Set<string>()
  const freeProviders = new Set<string>()
  const allowlist = new Set<string>()
  const roles = new Set<string>(ROLE_LOCAL_PARTS)
  for (const { result, domains } of loaded) {
    const target = result.kind === 'disposable' ? disposable
      : result.kind === 'free_provider' ? freeProviders
      : result.kind === 'role' ? roles
      : allowlist
    for (const d of domains) target.add(d)
  }

  // Precedence: the curated allowlists rescue false positives from the
  // disposable set (gmail etc. occasionally get swept up). After that,
  // disposable wins over free — the free-provider list is broad and includes
  // temp-mail domains and typo-squats (mailinator.com, gmial.com), while the
  // disposable lists are adversarially curated.
  let removed = 0
  for (const d of allowlist) {
    if (disposable.delete(d)) removed++
  }
  let freeOverlap = 0
  for (const d of disposable) {
    if (freeProviders.delete(d)) freeOverlap++
  }

  const version = new Date().toISOString().slice(0, 10)
  const dataset = {
    version,
    built_at: new Date().toISOString(),
    disposable: [...disposable].sort(),
    free_providers: [...freeProviders].sort(),
    roles: [...roles].sort()
  }
  const meta = {
    version,
    built_at: dataset.built_at,
    counts: {
      disposable: disposable.size,
      free_providers: freeProviders.size,
      roles: roles.size,
      allowlist_removed: removed,
      free_overlap_removed: freeOverlap
    },
    sources: results
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'dataset.json'), JSON.stringify(dataset))
  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  console.log(`\nDataset v${version}: ${disposable.size} disposable, ${freeProviders.size} free-provider, ${roles.size} role local-parts (${removed} rescued by allowlist, ${freeOverlap} free/disposable overlaps -> disposable)`)
  const failed = results.filter(r => r.status === 'failed')
  if (failed.length > 0) console.warn(`Note: ${failed.length} source(s) failed: ${failed.map(f => f.name).join(', ')}`)

  // Freshness changelog. Record adds/removes only between two fully-CLEAN
  // builds: a failed source makes its domains vanish and reappear, which
  // would pollute the feed with false churn. Skipping degraded builds means
  // additions during an outage get attributed to the recovery build's
  // timestamp — acceptable, and it self-heals.
  const changelogPath = join(OUT_DIR, 'changelog.json')
  const changelog = readJsonIfExists<Changelog>(changelogPath) ?? { updated_at: null, entries: [] }
  const currentClean = failed.length === 0
  const prevClean = prevMeta !== null && prevMeta.sources.every(s => s.status === 'ok')
  if (currentClean && prevClean && prevDataset) {
    const disp = diffLists(prevDataset.disposable, disposable)
    const free = diffLists(prevDataset.free_providers, freeProviders)
    const changes = disp.added.length + disp.removed.length + free.added.length + free.removed.length
    if (changes > 0) {
      changelog.entries.push({
        at: dataset.built_at,
        version,
        added: { disposable: disp.added, free_providers: free.added },
        removed: { disposable: disp.removed, free_providers: free.removed }
      })
    }
    changelog.updated_at = dataset.built_at
    const cutoff = new Date(Date.now() - CHANGELOG_RETENTION_DAYS * 86_400_000).toISOString()
    changelog.entries = changelog.entries.filter(e => e.at >= cutoff)
    writeFileSync(changelogPath, JSON.stringify(changelog))
    console.log(
      changes > 0
        ? `Changelog: +${disp.added.length}/-${disp.removed.length} disposable, +${free.added.length}/-${free.removed.length} free-provider (${changelog.entries.length} entries retained)`
        : 'Changelog: no domain changes since previous build'
    )
  } else {
    // Keep the file present (the Workers entry imports it statically) but
    // record nothing we can't stand behind.
    if (!existsSync(changelogPath)) writeFileSync(changelogPath, JSON.stringify(changelog))
    console.warn(
      `Changelog: skipped (${!prevDataset ? 'no previous dataset' : !prevClean ? 'previous build had failed sources' : 'this build had failed sources'})`
    )
  }
}

main()

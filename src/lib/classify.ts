import type { ParsedEmail } from './parse'

export interface Dataset {
  version: string
  disposable: Set<string>
  freeProviders: Set<string>
  roles: Set<string>
}

export interface DomainClassification {
  domain: string
  disposable: boolean
  /** The dataset entry that matched (the domain itself or a parent). */
  disposable_match: string | null
  free_provider: boolean
  did_you_mean: string | null
}

export interface EmailClassification extends DomainClassification {
  role_account: boolean
}

// Popular legitimate domains used for typo suggestions.
const POPULAR_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de',
  'mail.com', 'zoho.com', 'fastmail.com', 'yandex.com', 'comcast.net',
  'verizon.net', 'att.net', 'orange.fr', 'free.fr', 'qq.com', '163.com'
]

/** Walk the domain and its parents (a.b.c -> b.c) looking for a set hit. */
export function matchDomain(domain: string, set: Set<string>): string | null {
  let current = domain
  while (true) {
    if (set.has(current)) return current
    const dot = current.indexOf('.')
    if (dot === -1) return null
    current = current.slice(dot + 1)
    if (!current.includes('.')) {
      // Single label left (a bare TLD) — no list stores those.
      return null
    }
  }
}

// Damerau (OSA) distance: transpositions cost 1, because swapped letters
// (gmial -> gmail) are the most common email typo.
function damerau(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prevPrev: number[] | null = null
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prevPrev[j - 2] + 1)
      }
      curr[j] = d
      rowMin = Math.min(rowMin, d)
    }
    if (rowMin > max) return max + 1
    prevPrev = prev
    prev = curr
  }
  return prev[b.length]
}

export function suggestDomain(domain: string, maxDistance?: number): string | null {
  if (POPULAR_DOMAINS.includes(domain)) return null
  const max = maxDistance ?? (domain.length <= 6 ? 1 : 2)
  let best: string | null = null
  let bestDistance = max + 1
  for (const candidate of POPULAR_DOMAINS) {
    const d = damerau(domain, candidate, max)
    if (d < bestDistance) {
      bestDistance = d
      best = candidate
    }
  }
  return bestDistance <= max ? best : null
}

export function classifyDomain(domain: string, ds: Dataset): DomainClassification {
  const disposableMatch = matchDomain(domain, ds.disposable)
  const freeProvider = matchDomain(domain, ds.freeProviders) !== null
  // Typo suggestions: never for disposable domains (they're real, just burner)
  // and never for POPULAR domains themselves. Free-list domains still get
  // distance-1 suggestions because that list contains typo-squats of the
  // majors (gmial.com is literally on it); unknown domains get the full
  // distance budget.
  let didYouMean: string | null = null
  if (disposableMatch === null) {
    didYouMean = freeProvider ? suggestDomain(domain, 1) : suggestDomain(domain)
  }
  return {
    domain,
    disposable: disposableMatch !== null,
    disposable_match: disposableMatch,
    free_provider: freeProvider,
    did_you_mean: didYouMean
  }
}

export function classifyEmail(parsed: ParsedEmail, ds: Dataset): EmailClassification | null {
  if (!parsed.valid || parsed.local === null || parsed.domain === null) return null
  const base = classifyDomain(parsed.domain, ds)
  const plus = parsed.local.indexOf('+')
  const baseLocal = (plus === -1 ? parsed.local : parsed.local.slice(0, plus)).toLowerCase()
  return {
    ...base,
    role_account: ds.roles.has(baseLocal)
  }
}

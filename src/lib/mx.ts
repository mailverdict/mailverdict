export interface MxResult {
  checked: boolean
  valid: boolean
  records: string[]
  error?: string
}

interface DohAnswer {
  Status: number
  Answer?: Array<{ type: number; data: string }>
}

const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { expires: number; result: MxResult }>()

// DNS-over-HTTPS so the same code runs on Node and edge runtimes.
export async function lookupMx(domain: string): Promise<MxResult> {
  const cached = cache.get(domain)
  if (cached && cached.expires > Date.now()) return cached.result

  let result: MxResult
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) throw new Error(`DoH HTTP ${res.status}`)
    const data = (await res.json()) as DohAnswer
    const records = (data.Answer ?? [])
      .filter(a => a.type === 15)
      .map(a => a.data.split(' ').pop()?.replace(/\.$/, '') ?? '')
      .filter(r => r.length > 0)
    result = { checked: true, valid: records.length > 0, records }
  } catch (err) {
    result = {
      checked: false,
      valid: false,
      records: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // Don't cache transport failures; do cache authoritative answers.
  if (result.checked) {
    if (cache.size > 10_000) cache.clear()
    cache.set(domain, { expires: Date.now() + CACHE_TTL_MS, result })
  }
  return result
}

import type { Dataset } from './lib/classify'

export interface RawDataset {
  version: string
  built_at: string
  disposable: string[]
  free_providers: string[]
  roles: string[]
}

// Freshness changelog: per-build domain adds/removes, recorded by the pipeline
// only between two fully-clean builds (a failed source would read as false
// churn). Roles are excluded — they are local-parts and change ~never.
export interface ChangelogEntry {
  at: string
  version: string
  added: { disposable: string[]; free_providers: string[] }
  removed: { disposable: string[]; free_providers: string[] }
}

export interface Changelog {
  /** built_at of the last clean build that was checked (even if nothing changed). */
  updated_at: string | null
  /** Non-empty diffs only, oldest first. */
  entries: ChangelogEntry[]
}

export function toDataset(raw: RawDataset): Dataset {
  return {
    version: raw.version,
    disposable: new Set(raw.disposable),
    freeProviders: new Set(raw.free_providers),
    roles: new Set(raw.roles)
  }
}

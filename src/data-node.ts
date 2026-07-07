import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toDataset, type RawDataset, type Changelog } from './data'
import type { Dataset } from './lib/classify'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

export function loadDataset(): Dataset {
  const path = join(DATA_DIR, 'dataset.json')
  let raw: RawDataset
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(
      `Could not load ${path} — run "npm run build:data" first. (${err instanceof Error ? err.message : err})`
    )
  }
  return toDataset(raw)
}

/** Optional — deployments predating the changelog just don't serve the feed. */
export function loadChangelog(): Changelog | undefined {
  const path = join(DATA_DIR, 'changelog.json')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Changelog
  } catch {
    return undefined
  }
}

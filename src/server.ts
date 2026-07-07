import { serve } from '@hono/node-server'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { loadDataset, loadChangelog } from './data-node'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ds = loadDataset()
const app = createApp(ds, loadChangelog())

// Repo-root docs served as-is so agents can discover the API surface.
for (const [route, file, type] of [
  ['/llms.txt', 'llms.txt', 'text/plain'],
  ['/openapi.yaml', 'openapi.yaml', 'text/yaml']
] as const) {
  const path = join(root, file)
  if (existsSync(path)) {
    const content = readFileSync(path, 'utf8')
    app.get(route, c => c.text(content, 200, { 'content-type': type }))
  }
}

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, () => {
  console.log(
    `mailverdict listening on http://localhost:${port} — dataset v${ds.version}: ` +
    `${ds.disposable.size} disposable, ${ds.freeProviders.size} free-provider domains`
  )
})

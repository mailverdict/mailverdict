// Cloudflare Workers entry. The dataset, changelog, and agent docs are all
// bundled into the worker at deploy time (JSON imports + the "Text" rule in
// wrangler.toml), so the deployed API is fully self-contained — no KV, no
// assets, nothing to drift. The Node server (server.ts) serves the same app
// from disk.
import rawDataset from '../data/dataset.json'
import rawChangelog from '../data/changelog.json'
import llmsTxt from '../llms.txt'
import openapiYaml from '../openapi.yaml'
import { createApp } from './app'
import { toDataset, type RawDataset, type Changelog } from './data'

const app = createApp(toDataset(rawDataset as RawDataset), rawChangelog as Changelog)

// Same agent-discovery docs the Node entry serves from the repo root.
app.get('/llms.txt', c => c.text(llmsTxt, 200, { 'content-type': 'text/plain' }))
app.get('/openapi.yaml', c => c.text(openapiYaml, 200, { 'content-type': 'text/yaml' }))

export default app

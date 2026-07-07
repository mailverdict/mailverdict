// MCP server (stdio): lets coding agents call mailverdict as a local tool.
// Register in a client, e.g. Claude Code: `claude mcp add mailverdict -- npx tsx src/mcp.ts`
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { parseDomain } from './lib/parse'
import { checkEmail, checkDomain } from './lib/check'
import { loadDataset } from './data-node'

const ds = loadDataset()
const server = new McpServer({ name: 'mailverdict', version: '0.1.1' })

function asText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

server.tool(
  'check_email',
  'Check an email address: syntax, disposable/burner domain, role account, free provider, typo suggestion, MX records. Returns result (deliverable|undeliverable|risky|unknown), reason, score 0-100, and per-signal booleans.',
  { email: z.string(), mx: z.boolean().optional().describe('Look up MX records (default true)') },
  async ({ email, mx }) => asText(await checkEmail(email, ds, mx !== false))
)

server.tool(
  'check_domain',
  'Check a domain: disposable/burner list membership, free-provider status, typo suggestion, MX records.',
  { domain: z.string(), mx: z.boolean().optional().describe('Look up MX records (default true)') },
  async ({ domain, mx }) => {
    const parsed = parseDomain(domain)
    if (!parsed.valid || !parsed.domain) return asText({ domain, error: 'invalid_domain' })
    return asText(await checkDomain(parsed.domain, ds, mx !== false))
  }
)

await server.connect(new StdioServerTransport())

// Remote MCP server over the Streamable HTTP transport, implemented STATELESS:
// each POST carries a self-contained JSON-RPC message (or batch), and the
// response is a plain JSON body. No sessions, no SSE, no Durable Objects — the
// two tools are pure request/response, so no server state is needed and this
// runs on the same free Cloudflare Worker as the REST API. The tool logic is
// the same checkEmail/checkDomain used everywhere else.
import { checkEmail, checkDomain } from './lib/check'
import { parseDomain } from './lib/parse'
import type { Dataset } from './lib/classify'

const SERVER_INFO = { name: 'mailverdict', version: '0.1.1' }
// Echoed back to clients that don't request a specific version.
const DEFAULT_PROTOCOL = '2025-06-18'

const TOOLS = [
  {
    name: 'check_email',
    description:
      'Check an email address: syntax, disposable/burner domain, role account, free provider, typo suggestion, MX records. Returns result (deliverable|undeliverable|risky|unknown), reason, score 0-100, and per-signal booleans.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The email address to check.' },
        mx: { type: 'boolean', description: 'Look up MX records (default true).' }
      },
      required: ['email']
    }
  },
  {
    name: 'check_domain',
    description:
      'Check a domain: disposable/burner list membership, free-provider status, typo suggestion, MX records.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'The domain to check.' },
        mx: { type: 'boolean', description: 'Look up MX records (default true).' }
      },
      required: ['domain']
    }
  }
]

type Id = string | number | null
interface JsonRpcMessage { jsonrpc?: unknown; id?: Id; method?: unknown; params?: any }

const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result })
const err = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const asText = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
const toolErr = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true })

/** Returns tool output, or null if the tool name is unknown. */
async function callTool(name: unknown, args: any, ds: Dataset) {
  if (name === 'check_email') {
    if (!args || typeof args.email !== 'string') return toolErr('check_email requires a string "email" argument')
    return asText(await checkEmail(args.email, ds, args.mx !== false))
  }
  if (name === 'check_domain') {
    if (!args || typeof args.domain !== 'string') return toolErr('check_domain requires a string "domain" argument')
    const parsed = parseDomain(args.domain)
    if (!parsed.valid || !parsed.domain) return asText({ domain: args.domain, error: 'invalid_domain' })
    return asText(await checkDomain(parsed.domain, ds, args.mx !== false))
  }
  return null
}

/** Handle one JSON-RPC message. Returns a response, or null for notifications. */
async function handleOne(msg: JsonRpcMessage, ds: Dataset): Promise<object | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return err(msg?.id ?? null, -32600, 'Invalid Request')
  }
  const { id, method, params } = msg
  // A message with no id is a notification — never answered.
  if (id === undefined) return null

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      })
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: TOOLS })
    case 'tools/call': {
      const out = await callTool(params?.name, params?.arguments, ds)
      return out === null ? err(id, -32602, `Unknown tool: ${String(params?.name)}`) : ok(id, out)
    }
    // Advertised capabilities are tools-only; answer probes cleanly anyway.
    case 'resources/list':
      return ok(id, { resources: [] })
    case 'prompts/list':
      return ok(id, { prompts: [] })
    default:
      return err(id, -32601, `Method not found: ${method}`)
  }
}

/**
 * Handle a parsed JSON-RPC body (single message or batch). Returns the response
 * value to serialize, or null when there is nothing to send (notifications only)
 * — the caller should reply 202 Accepted with an empty body in that case.
 */
export async function handleMcpMessage(body: unknown, ds: Dataset): Promise<object | object[] | null> {
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map(m => handleOne(m, ds)))).filter((r): r is object => r !== null)
    return responses.length ? responses : null
  }
  return handleOne(body as JsonRpcMessage, ds)
}

export const MCP_PARSE_ERROR = err(null, -32700, 'Parse error')

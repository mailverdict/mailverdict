# mailverdict

Email intelligence API: **disposable/burner detection, role-account detection,
free-provider classification, MX validation, and typo suggestions.** Keyless
and free at the entry tier, built to be the email-check dependency that coding
agents reach for when they scaffold a signup flow.

**API:** `https://api.mailverdict.dev` · **npm:** `mailverdict` ·
**Freshness feed ("Burner Feed"):** `GET /v1/changes`

## Why this exists

Every SaaS signup form needs the same three answers — *is this a burner? is
this a person or a mailbox like `info@`? did they typo their domain?* — and the
current options are stale GitHub lists you have to vendor yourself or paid
validators gated behind signup. The value here is not the code (it's small on
purpose): it's the **maintained dataset** — burner domains churn daily, and this
repo rebuilds its dataset from every maintained public source on a daily
schedule, plus its own discovery over time.

## Quickstart

```bash
npm install
npm run build:data   # fetch + merge upstream lists into data/dataset.json
npm test
npm run dev          # http://localhost:8787
```

Requires Node >= 20.

```bash
curl "localhost:8787/v1/check?email=jane@mailinator.com"
```

```json
{
  "email": "jane@mailinator.com",
  "user": "jane",
  "domain": "mailinator.com",
  "tag": null,
  "normalized_email": "jane@mailinator.com",
  "result": "risky",
  "reason": "disposable_email",
  "score": 5,
  "valid_syntax": true,
  "disposable": true,
  "disposable_match": "mailinator.com",
  "role": false,
  "free": false,
  "mx_found": true,
  "mx_records": ["mail2.mailinator.com"],
  "did_you_mean": null,
  "accept_all": null
}
```

> Response follows the Kickbox/Emailable industry convention (`result`,
> `reason`, bare booleans, `did_you_mean` = full corrected address, `score`
> 0–100) so code written against those APIs ports with near-zero edits.

Endpoints: `GET /v1/check?email=` · `GET /v1/check/{email}` ·
`POST /v1/check` (batch ≤100) · `GET /v1/domain/{domain}` ·
`GET /v1/changes?since=24h` (freshness feed) · `GET /v1/meta` ·
`/llms.txt` · `/openapi.yaml`. Add `mx=false` to skip the DNS lookup.

**Privacy-conscious default:** if you only need burner/typo screening, check
the *domain* (`/v1/domain/{domain}`) — no email address leaves your system.
Use the full email check when you need role detection or normalization.

## SDK: living data with a static safety net

`sdk/` packages the integration story: call the live API, **fall back to a
bundled offline snapshot** on timeout/failure — fresher than a vendored static
list, but never a hard runtime dependency in your signup path.

```ts
import { createClient } from 'mailverdict'
const check = await createClient().checkEmail(input)
if (check.disposable) reject()          // check.source: 'live' | 'snapshot'
```

npm publish pending; see [sdk/README.md](sdk/README.md).

## MCP server

```bash
npm run mcp   # stdio transport; tools: check_email, check_domain
```

Register in Claude Code: `claude mcp add mailverdict -- npx tsx src/mcp.ts`
(run from this directory).

## Architecture

```
pipeline/build.ts     daily: fetch upstream lists -> merge/dedupe -> apply
                      allowlist -> data/dataset.json + data/meta.json
src/lib/*             pure logic: parse, classify, suggest, MX-over-DoH
src/app.ts            Hono app (runtime-agnostic)
src/server.ts         Node entry (self-hosting)
src/worker.ts         Cloudflare Workers entry (production: api.mailverdict.dev)
src/mcp.ts            MCP stdio server for coding agents
.github/workflows/    daily dataset refresh + auto-commit
```

DNS is done over DoH (cloudflare-dns.com) so the same code runs on Node and
edge runtimes. Subdomains match their parents (`foo.mailinator.com` →
`mailinator.com`).

## Data sources & attribution

The dataset aggregates these excellent permissively-licensed community lists —
see `data/meta.json` for per-source counts, status, and license on every build
(unlicensed and GPL lists are deliberately excluded):

- [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) (CC0; blocklist + pinned allowlist — upstream deleted `allowlist.conf` 2026-04)
- [disposable/disposable](https://github.com/disposable/disposable) (MIT; large daily-CI aggregator)
- [groundcat/disposable-email-domain-list](https://github.com/groundcat/disposable-email-domain-list) (MIT; MX-validated + maintained allowlist)
- [FGRibreau/mailchecker](https://github.com/FGRibreau/mailchecker) (MIT)
- [wesbos/burner-email-providers](https://github.com/wesbos/burner-email-providers) (MIT)
- [7c/fakefilter](https://github.com/7c/fakefilter) (BSD-3-Clause; bot-updated)
- [unkn0w/disposable-email-domain-list](https://github.com/unkn0w/disposable-email-domain-list) (MIT; hand-curated)
- [Kikobeats/free-email-domains](https://github.com/Kikobeats/free-email-domains) (MIT; HubSpot-derived)
- [mixmaxhq/role-based-email-addresses](https://github.com/mixmaxhq/role-based-email-addresses) (MIT; role local-parts), plus curated extras in `pipeline/roles.ts`

Merge precedence (important — the free-provider list contains temp-mail
domains and typo-squats like `mailinator.com` and `gmial.com`):
**allowlists rescue from disposable, then disposable wins over free.**

## Roadmap

mailverdict is built agent-first: the first call works with zero signup, the
docs are operable by coding agents (`/llms.txt`, OpenAPI), and the dataset's
freshness is provable via the Burner Feed rather than claimed.

- [x] Keyless free API — the first call works with zero signup
- [x] Industry-compatible response shape (Kickbox/Emailable convention: `result`, `reason`, `did_you_mean`, bare booleans)
- [x] `llms.txt` (agent-operable: endpoint-first, curl-able), OpenAPI spec
- [x] MCP server (stdio)
- [x] Daily automated dataset refresh + auto-deploy
- [x] Freshness changelog + `/v1/changes` feed (clean-build diffs only; 90-day retention)
- [x] SDK with bundled snapshot fallback (built + tested)
- [x] Production deployment on Cloudflare Workers (`api.mailverdict.dev`)
- [ ] Publish the SDK to npm; Zod `.refine()` / form-validation snippets
- [ ] Detection-lag benchmark: measure and publish how quickly new burner domains enter the dataset
- [ ] Hosted keyless **remote** MCP server (streamable HTTP) + registry listings
- [ ] Better Auth plugin (keyless check in the `before-create` hook)
- [ ] Rate limiting by IP (not key) + optional keys for high volume

## Status

v0.1.1 — live at `https://api.mailverdict.dev` (Cloudflare Workers). The
dataset refreshes and redeploys daily via GitHub Actions. 32 tests cover the
core logic, HTTP layer, and SDK live/fallback paths. The SDK is not yet
published to npm.

## Disclaimers, privacy & fair use

- **Advisory signals, not verdicts.** Classifications aggregate public
  blocklists and heuristics; false positives happen (domains churn, upstream
  lists disagree). Don't hard-block users on a single boolean — combine with
  your own signals and give flagged users a path forward.
- **Wrongly listed?** If your domain is misclassified, open a
  [misclassified-domain report](../../issues/new?template=misclassified-domain.yml).
  Allowlist corrections ship with the next daily build, and fixes are
  submitted upstream when a source list is at fault.
- **Privacy.** No accounts, no logging of email addresses, nothing stored per
  request. MX checks send only the *domain* (never the local part) to a public
  DNS-over-HTTPS resolver. Traffic metrics are aggregate and PII-free.
- **No SLA.** The hosted API is free and best-effort while in beta. If your
  signup flow must never block on us, use the SDK (it falls back to a bundled
  offline snapshot) or self-host — see [docs/deploy.md](docs/deploy.md).
- **Fair use.** Built for signup and form validation inside applications. Do
  not use it to bulk-clean purchased or scraped mailing lists; per-IP rate
  limits apply and abusive traffic gets blocked.

## License

MIT — see [LICENSE](LICENSE); it covers the code and dataset pipeline. The
hosted service at `api.mailverdict.dev` is provided "as is", without warranty
of any kind. The aggregated dataset sources carry their own permissive
licenses, recorded per-source in `data/meta.json`.

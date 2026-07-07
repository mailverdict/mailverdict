# mailverdict SDK

Living data with a static safety net. `checkEmail`/`checkDomain` call the live
API (freshest dataset, MX checks, full response) and **fall back to a bundled
offline snapshot** when the API is unreachable, slow, or erroring — so it is
never a hard runtime dependency in your signup path.

Strictly better than both existing options:

- fresher than a vendored static list (the widely-used `disposable-email-domains`
  package is a text file frozen at install time; burner domains churn daily);
- safer than a bare API call (network failure degrades to the snapshot instead
  of breaking signup).

## Install

```bash
npm install mailverdict
```

Requires Node 18+ (uses global `fetch`). Ships as dual ESM/CJS with TypeScript
types. No runtime dependencies. Keyless — no API key or signup.

```ts
import { createClient } from 'mailverdict'

const mailverdict = createClient()

const check = await mailverdict.checkEmail(input)
if (check.disposable || check.result === 'undeliverable') reject()
if (check.did_you_mean) suggest(check.did_you_mean)

// check.source tells you which path answered: 'live' | 'snapshot'
```

Privacy-sensitive? Domain-only checks never send the address anywhere, and
`mode: 'snapshot'` never touches the network at all:

```ts
const domain = input.split('@').pop()!
const d = await mailverdict.checkDomain(domain)     // no PII leaves your system
const offline = createClient({ mode: 'snapshot' })  // no network, period
```

Options: `baseUrl` (API origin), `timeoutMs` (budget before fallback, default
2000), `mode` (`auto` | `live` | `snapshot`).

## How the offline snapshot stays fresh

The bundled snapshot is regenerated from the live dataset on every release, so
each published version carries a recent copy. `SNAPSHOT_VERSION` reports the
build date of the bundled data; the live API always reports its own current
version via `/v1/meta`.

`src/vendor/` and `src/snapshot.json` are **generated** from the repo's
canonical logic and dataset (`npm run build:snapshot` at the repo root) — they
are not edited by hand.

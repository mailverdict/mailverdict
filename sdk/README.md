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

## Regenerating the offline layer

`src/vendor/` and `src/snapshot.json` are **generated** from the repo's
canonical logic and dataset — do not edit them here:

```bash
npm run build:data      # refresh the dataset (repo root)
npm run build:snapshot  # re-vendor logic + snapshot into the SDK
```

## Pre-publish TODOs

- Switch the build to tsup (dual ESM/CJS + extension-resolved imports) before
  the first npm publish; the current `tsc` build assumes bundler consumers.
- Remove `"private": true` and `npm publish` (the default endpoint is live).

# Deployment

The app is runtime-agnostic (`src/app.ts`); two deployment paths exist.

## Production: Cloudflare Workers

Production serves at `https://api.mailverdict.dev` via `src/worker.ts`.
The dataset, changelog, and agent docs are bundled into the worker at deploy
time (~485 KB gzipped, 5 ms startup) — no external storage.

- Deploy: `npx wrangler deploy` (after `npx wrangler login`).
- The custom domain route lives in `wrangler.toml`; wrangler manages the DNS
  record and certificate.
- **The daily GitHub Action redeploys after each dataset refresh** — required,
  because the dataset is bundled and the live API would go stale otherwise.
  It uses the `CLOUDFLARE_API_TOKEN` repo secret ("Edit Cloudflare Workers"
  token template) and skips the deploy step if the secret is absent.
- Local validation without deploying: `npx wrangler dev` (runs the real
  workerd runtime; no auth needed).

### Cloudflare dashboard configuration

1. Cache Rule on `api.mailverdict.dev`: cache `/v1/domain/*`, `/v1/meta`,
   `/llms.txt`, `/openapi.yaml`; short TTL (5–15 min) on `/v1/changes`;
   **bypass** `/v1/check*` (per-email, and MX lookups are live).
2. Rate-limiting rule on `api.mailverdict.dev` (N req/min per IP) — the
   throttle for keyless access; there are no API keys in v1.

## Self-hosting: Docker + Cloudflare Tunnel

An alternative origin for anyone running the API on their own hosts. No
inbound ports are exposed; `cloudflared` makes the only outbound connection.

- `Dockerfile` — `node:24-alpine`, runs `npm start` under tini. Healthcheck
  hits `/v1/meta` (network-free, never flaps on DNS).
- `docker-compose.yml` — `api` service (no published ports) + `cloudflared`
  sharing the compose network.
- `.env.example` — `TUNNEL_TOKEN`; copy to `.env` (gitignored) per host.

Bring-up on each host:

```bash
cp .env.example .env        # paste the tunnel token
docker compose up -d --build
docker compose ps           # api healthy, cloudflared connected
curl -s https://api.<domain>/v1/meta
```

Run identical copies on two or three hosts with the **same** tunnel token;
Cloudflare load-balances across replicas and rides out any single host
dropping. Tunnel setup (dashboard): Zero Trust → Networks → Tunnels → create a
tunnel, copy its token, add a public hostname `api.<domain>` →
`http://api:8787`.

Note: the compose config is validated, but this path hasn't been exercised in
production — test the image end-to-end before relying on it.

## Operational notes

- **We never log email addresses.** Aggregate request counts come from
  Cloudflare zone analytics (PII-free).
- Status page: point Uptime Kuma (or similar) at
  `https://api.mailverdict.dev/v1/meta`.
- Dataset freshness: the GitHub Action refreshes data daily and redeploys the
  worker; self-hosted replicas pick up new data on their next image rebuild
  (or add a pull+recreate cron).

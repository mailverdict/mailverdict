# mailverdict API — single-process Node image for self-hosted deployments.
# Runtime-agnostic Hono app; this wraps the Node entry (src/server.ts via tsx).
FROM node:24-alpine

# tini for correct signal handling (fast Ctrl-C / clean container stop).
RUN apk add --no-cache tini

WORKDIR /app

# Install deps first for layer caching. tsx/typescript are dev deps but the
# start script runs via tsx, so we install everything (image stays small).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# App source, committed dataset, and agent-facing docs served at the root.
COPY tsconfig.json ./
COPY src ./src
COPY data ./data
COPY llms.txt openapi.yaml ./

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Liveness: /v1/meta is network-free (no DoH), so it never flaps on DNS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/v1/meta').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]

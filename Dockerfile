# Use the bundled BuildKit frontend; do not fetch an extra Dockerfile frontend image.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS builder
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG BUILD_NODE_OPTIONS=
ARG BUILD_CPUS=2
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=${BUILD_NODE_OPTIONS} EKIDEN_BUILD_CPUS=${BUILD_CPUS}
COPY . .
# The optional development proxy CA is a build secret, never an image layer.
# Install and build in one layer to avoid retaining caches in intermediate layers.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    node ops/npm-lock-registry.mjs "$NPM_REGISTRY" && \
    echo EKIDEN_PHASE_DEPENDENCIES && \
    (npm ci --registry="$NPM_REGISTRY" --strict-ssl=true --cache /tmp/npm-cache --no-audit --no-fund || { echo EKIDEN_NPM_CI_FAILED; exit 41; }) && \
    echo EKIDEN_PHASE_BUILD && \
    (npm run build || { echo EKIDEN_NEXT_BUILD_FAILED; exit 42; }) && rm -rf /tmp/npm-cache

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS=--max-old-space-size=256
RUN groupadd --gid 1001 nextjs && useradd --uid 1001 --gid nextjs --no-create-home nextjs
COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=builder --chown=1001:1001 /app/public ./public
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const b=await r.json();if(!r.ok||b.status!=='ok'||b.service!=='ekiden-database')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

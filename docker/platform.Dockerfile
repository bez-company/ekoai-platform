# syntax=docker/dockerfile:1
# Plataforma (Next) para o Cloud Run. Contexto de build: a raiz do repo.
#   docker build -f docker/platform.Dockerfile -t ekoai-platform .
FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# O pacote local entra antes: `npm ci` da plataforma o liga por link (file:../packages/db).
COPY packages/db packages/db
COPY platform/package.json platform/package-lock.json platform/
RUN cd platform && npm ci --no-audit
COPY platform platform
RUN cd platform && npm run build

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Saída standalone: servidor e node_modules rastreados, sem o resto do projeto.
COPY --from=build --chown=node:node /app/platform/.next/standalone ./
COPY --from=build --chown=node:node /app/platform/.next/static ./.next/static
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]

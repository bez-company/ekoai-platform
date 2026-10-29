# syntax=docker/dockerfile:1
# Job do estúdio de posts (SPEC 030 F3c, ADR 0028): Chromium do sistema + o job empacotado num arquivo só. Contexto: a raiz do repo.
#   docker build -f docker/studio.Dockerfile -t ekoai-studio .
#   docker run --rm -e DATABASE_URL=... -e STUDIO_TENANT=... -e STUDIO_BRIEF=... -e VERTEX_PROJECT_ID=... ekoai-studio
# Só esta imagem tem Chromium; a da plataforma e a dos jobs de métricas não mudam.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY packages/db packages/db
COPY platform/package.json platform/package-lock.json platform/
RUN cd platform && npm ci --no-audit --ignore-scripts
COPY platform platform
RUN cd platform && node scripts/build-studio-job.mjs dist-job/studio-job.mjs

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    STUDIO_FONT_DIR=/app/fonts
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ca-certificates tini fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/platform/dist-job/studio-job.mjs ./studio-job.mjs
# Só as fontes curadas: o render do estúdio não usa fonte da rede nem do sistema.
COPY --from=build /app/platform/fonts ./fonts
USER node
ENTRYPOINT ["tini", "--", "node", "studio-job.mjs"]

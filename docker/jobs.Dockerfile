# syntax=docker/dockerfile:1
# Jobs (métricas, renovação de token, migrate) para os Cloud Run Jobs. Contexto: a raiz do repo.
#   docker build -f docker/jobs.Dockerfile -t ekoai-jobs .
#   docker run --rm -e DATABASE_URL=... -e TENANT_ID=... ekoai-jobs weekly-report
# Sem Chromium: o render de artes saiu com o pipeline de geração (ADR 0010) e volta na fase 2.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/db packages/db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src src
COPY scripts scripts
COPY supabase/migrations supabase/migrations
COPY supabase/ci/bootstrap.sql supabase/ci/bootstrap.sql
USER node
ENTRYPOINT ["tini", "--", "node", "src/jobs.js"]
CMD ["weekly-report"]

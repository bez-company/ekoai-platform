# syntax=docker/dockerfile:1
# Jobs (geração, resolve, métricas, migrate...) para os Cloud Run Jobs. Contexto: a raiz do repo.
#   docker build -f docker/jobs.Dockerfile -t ekoai-jobs .
#   docker run --rm -e DATABASE_URL=... ekoai-jobs post
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Chromium para o render das artes (puppeteer) e a fonte Inter dos templates.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-inter fonts-liberation ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/db packages/db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src src
COPY scripts scripts
COPY prompts prompts
COPY templates templates
COPY assets assets
COPY docs docs
COPY content content
COPY supabase/migrations supabase/migrations
COPY supabase/ci/bootstrap.sql supabase/ci/bootstrap.sql
# Os jobs gravam arquivos de trabalho (tmp, content/kb-index.json) no diretório do app.
RUN chown -R node:node /app
USER node
ENTRYPOINT ["tini", "--", "node", "src/jobs.js"]
CMD ["post"]

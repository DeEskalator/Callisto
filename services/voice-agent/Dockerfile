# The voice agent as a container. Built from the repository root, because it bundles code from
# the shared packages: docker build -f services/voice-agent/Dockerfile .

FROM public.ecr.aws/docker/library/node:24-slim AS build
WORKDIR /app
# Manifests first, so the dependency layer is reused as long as no dependency changes.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/data/package.json packages/data/
COPY services/api/package.json services/api/
COPY services/voice-agent/package.json services/voice-agent/
COPY apps/web/package.json apps/web/
COPY infra/package.json infra/
RUN npm ci --workspace @callisto/voice-agent --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/data packages/data
COPY services/voice-agent services/voice-agent
RUN npm run bundle --workspace @callisto/voice-agent

FROM public.ecr.aws/docker/library/node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/services/voice-agent/dist/ ./
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "main.mjs"]

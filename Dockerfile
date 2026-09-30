# Debian slim (not Alpine): onnxruntime-node, used for local embeddings, needs glibc.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MODEL_CACHE_DIR=/app/.data/models \
    PGLITE_DIR=/app/.data/pglite
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/eval/fixtures ./eval/fixtures
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
VOLUME ["/app/.data"]
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]

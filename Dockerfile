# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_DIST=/app/web/dist

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./
COPY --from=web-build /web/dist ./web/dist

EXPOSE 4000
USER node
ENTRYPOINT ["node", "scripts/docker-entrypoint.js"]

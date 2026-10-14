# Krestrel app image. Local use only: compose publishes it on 127.0.0.1 (ADR 0007).
# Bun installs packages and runs the build; Node 24 LTS runs the server (ADR 0001).

FROM oven/bun:1.4.3-alpine AS bun

FROM node:24-alpine AS base
# Bun's musl build needs the C++ runtime.
RUN apk add --no-cache libstdc++ libgcc
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM deps AS build
COPY . .
RUN bun run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# Committed migrations, applied automatically at server start (app/.server/startup.ts).
COPY drizzle ./drizzle
USER node
EXPOSE 3000
# HOST=0.0.0.0 is container-internal; exposure is limited by the 127.0.0.1 port binding in compose.
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]

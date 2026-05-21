FROM node:22-bullseye AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

# BUILD_ID is baked into the bundle by vite.config.ts so a new deploy
# invalidates clients' sessionStorage (see frontend/src/lib/buildReset.ts).
# Defaults to the build-time epoch — Cloud Build / docker can override.
ARG BUILD_ID
ENV BUILD_ID=${BUILD_ID}
ENV TAILWIND_DISABLE_OXIDE=1
RUN BUILD_ID="${BUILD_ID:-$(date +%s)}" npm run build
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:22-bullseye AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 8080

CMD ["npm", "start"]

FROM node:22-bullseye AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

ENV TAILWIND_DISABLE_OXIDE=1
RUN npm run build
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

# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++ openssl zeromq-dev
WORKDIR /app
COPY backend/package*.json ./
RUN npm install

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl zeromq-dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ .
RUN npx prisma generate && npm run build \
  && npm prune --omit=dev

FROM node:20-alpine AS runner
RUN apk add --no-cache ffmpeg openssl fontconfig ttf-dejavu zeromq
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001

CMD ["sh", "-c", "for i in 1 2 3 4 5 6 7 8 9 10; do npx prisma db push --accept-data-loss && break; echo \"Waiting for database...\"; sleep 3; done && node dist/seed.js && exec node dist/index.js"]

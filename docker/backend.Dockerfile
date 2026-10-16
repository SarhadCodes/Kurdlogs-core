FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 make g++ openssl fontconfig ttf-dejavu zeromq-dev

WORKDIR /app

COPY backend/package*.json ./
RUN npm install

COPY backend/ .
RUN npx prisma generate
RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "for i in 1 2 3 4 5 6 7 8 9 10; do npx prisma db push --accept-data-loss && break; echo \"Waiting for database...\"; sleep 3; done && node dist/seed.js && exec node dist/index.js"]

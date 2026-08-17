FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/frontend-nginx-main.conf /etc/nginx/nginx.conf
COPY docker/frontend-nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/runtime-config.template.js /etc/kurdlogs/runtime-config.template.js
COPY docker/40-kurdlogs-runtime-config.sh /docker-entrypoint.d/40-kurdlogs-runtime-config.sh
RUN chmod 755 /docker-entrypoint.d/40-kurdlogs-runtime-config.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

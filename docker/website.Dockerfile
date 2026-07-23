FROM node:20-alpine AS builder
WORKDIR /app
COPY website/package*.json ./
RUN npm install
COPY website/ .
ARG VITE_PANEL_URL=http://localhost:8081
ENV VITE_PANEL_URL=$VITE_PANEL_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/website-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

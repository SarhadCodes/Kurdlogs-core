FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    build-base \
    pcre-dev \
    openssl-dev \
    zlib-dev \
    git

# Download NGINX and RTMP module
ENV NGINX_VERSION=1.25.3
RUN wget http://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz && \
    tar -xzf nginx-${NGINX_VERSION}.tar.gz && \
    git clone https://github.com/arut/nginx-rtmp-module.git

RUN cd nginx-${NGINX_VERSION} && \
    ./configure \
        --prefix=/etc/nginx \
        --add-module=../nginx-rtmp-module \
        --with-http_ssl_module \
        --with-http_secure_link_module \
        --with-http_auth_request_module \
        --with-http_stub_status_module \
        --conf-path=/etc/nginx/nginx.conf \
        --error-log-path=/var/log/nginx/error.log \
        --http-log-path=/var/log/nginx/access.log \
        --sbin-path=/usr/sbin/nginx && \
    make && make install

FROM alpine:3.19
RUN apk add --no-cache pcre openssl zlib
COPY --from=builder /usr/sbin/nginx /usr/sbin/nginx
COPY --from=builder /etc/nginx /etc/nginx
COPY nginx.conf /etc/nginx/nginx.conf

RUN mkdir -p /var/streams /tmp/hls /var/log/nginx

EXPOSE 1936 8080

CMD ["nginx", "-g", "daemon off;"]

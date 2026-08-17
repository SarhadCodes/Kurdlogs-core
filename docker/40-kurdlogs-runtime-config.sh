#!/bin/sh
set -eu

template=/etc/kurdlogs/runtime-config.template.js
target=/usr/share/nginx/html/runtime-config.js
temporary="${target}.tmp"

envsubst '${KURDLOGS_PUBLIC_SITE_URL} ${KURDLOGS_APP_URL} ${KURDLOGS_API_URL} ${KURDLOGS_CDN_URL}' \
  < "$template" > "$temporary"
mv "$temporary" "$target"

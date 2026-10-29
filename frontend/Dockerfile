ARG NODE_IMAGE=node:22-bookworm-slim
ARG CADDY_IMAGE=caddy:2-alpine
FROM ${NODE_IMAGE} AS build
ARG VITE_ENABLE_WATER_SPORTS=false
ENV VITE_ENABLE_WATER_SPORTS=${VITE_ENABLE_WATER_SPORTS}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM ${CADDY_IMAGE}
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

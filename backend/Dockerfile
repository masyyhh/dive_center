ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc && npm prune --omit=dev --ignore-scripts

FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=5001
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json package-lock.json ./
COPY tools ./tools
COPY entrypoint.sh ./entrypoint.sh
RUN chmod 755 /app/entrypoint.sh
USER node
EXPOSE 5001
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]

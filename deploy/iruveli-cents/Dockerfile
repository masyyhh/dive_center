ARG PRODUCTION_BACKEND_IMAGE
FROM ${PRODUCTION_BACKEND_IMAGE}
WORKDIR /app
COPY --chown=node:node runtime/ /app/dist/
USER node
# Deliberately bypass the baseline entrypoint's automatic migrations.
# The existing application reads its unchanged *_FILE secret settings itself.
ENTRYPOINT ["node"]
CMD ["dist/index.js"]

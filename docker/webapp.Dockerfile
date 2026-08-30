# syntax=docker/dockerfile:1

# node:22 -- engines allows "^20.19.0 || >=22.0.0". Not alpine: sql.js ships
# wasm and there is nothing to gain from musl here.
FROM node:22-bookworm-slim AS build
WORKDIR /app/gmail-contact-graph/webapp

# npm ci validates the single root lockfile against EVERY workspace manifest,
# so all four package.json files must be present before it runs. Copying them
# ahead of the sources is what keeps the install layer cached across code edits.
COPY gmail-contact-graph/webapp/package.json gmail-contact-graph/webapp/package-lock.json ./
COPY gmail-contact-graph/webapp/packages/shared/package.json ./packages/shared/
COPY gmail-contact-graph/webapp/packages/server/package.json ./packages/server/
COPY gmail-contact-graph/webapp/packages/client/package.json ./packages/client/
RUN npm ci

COPY gmail-contact-graph/webapp/ ./
RUN npm run build

# Production dependencies, installed in the same workspace layout so npm
# recreates node_modules/@gmail-graph/shared -> ../../packages/shared as a
# symlink. Copying node_modules without the target of that symlink gives
# ERR_MODULE_NOT_FOUND at startup.
FROM node:22-bookworm-slim AS deps
WORKDIR /app/gmail-contact-graph/webapp
COPY gmail-contact-graph/webapp/package.json gmail-contact-graph/webapp/package-lock.json ./
COPY gmail-contact-graph/webapp/packages/shared/package.json ./packages/shared/
COPY gmail-contact-graph/webapp/packages/server/package.json ./packages/server/
COPY gmail-contact-graph/webapp/packages/client/package.json ./packages/client/
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime

# Nothing in this codebase branches on NODE_ENV, but Express does: without it
# the app runs in development mode, which serves full stack traces on errors
# and skips the view/etag caching. Only in this stage -- the build stages need
# the dev dependencies that `npm ci` would otherwise skip.
ENV NODE_ENV=production

# The directory layout is load-bearing: config.ts derives PROJECT_ROOT by
# walking four levels up from packages/server/dist and then resolves DATA_DIR
# as ../data -- i.e. /app/data. Do not flatten this tree.
WORKDIR /app/gmail-contact-graph/webapp

COPY --from=deps  /app/gmail-contact-graph/webapp/node_modules ./node_modules
COPY --from=build /app/gmail-contact-graph/webapp/package.json ./
COPY --from=build /app/gmail-contact-graph/webapp/packages/shared/package.json ./packages/shared/
COPY --from=build /app/gmail-contact-graph/webapp/packages/server/package.json ./packages/server/
COPY --from=build /app/gmail-contact-graph/webapp/packages/client/package.json ./packages/client/
COPY --from=build /app/gmail-contact-graph/webapp/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/gmail-contact-graph/webapp/packages/server/dist ./packages/server/dist
# index.ts:40 serves static files from __dirname/../../client/dist. Without
# this the API works and the page is blank.
COPY --from=build /app/gmail-contact-graph/webapp/packages/client/dist ./packages/client/dist

COPY docker/webapp-entrypoint.sh /usr/local/bin/webapp-entrypoint.sh
RUN chmod +x /usr/local/bin/webapp-entrypoint.sh

WORKDIR /app/gmail-contact-graph/webapp/packages/server
USER node
ENTRYPOINT ["/usr/local/bin/webapp-entrypoint.sh"]

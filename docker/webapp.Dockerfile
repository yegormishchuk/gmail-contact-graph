# syntax=docker/dockerfile:1

# The webapp runs the parsers itself when you import a mailbox from the UI, so
# the image carries fill_db and fill_events. They are built exactly as in
# docker/parsers.Dockerfile (see there for the manifest-stub caching and the
# OpenSSL notes); generate_rankings is left out, the webapp does not read the
# ranking files. Keep the two builds in step when either changes.
FROM rust:1.87-bookworm AS parsers
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /out

WORKDIR /build/gmail-mbox-parser
COPY gmail-mbox-parser/Cargo.toml gmail-mbox-parser/Cargo.lock ./
RUN mkdir -p src/bin/fill_db \
    && : > src/lib.rs \
    && echo 'fn main(){}' > src/bin/fill_db/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    cargo build --release --bin fill_db
COPY gmail-mbox-parser/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    touch src/lib.rs src/bin/fill_db/main.rs \
    && cargo build --release --bin fill_db \
    && cp target/release/fill_db /out/fill_db

WORKDIR /build/calendar-parser
COPY calendar-parser/Cargo.toml calendar-parser/Cargo.lock ./
RUN mkdir -p src/bin/fill_events && echo 'fn main(){}' > src/bin/fill_events/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    cargo build --release --bin fill_events
COPY calendar-parser/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    touch src/bin/fill_events/main.rs \
    && cargo build --release --bin fill_events \
    && cp target/release/fill_events /out/fill_events

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

# The parsers' runtime needs, as in docker/parsers.Dockerfile: ca-certificates
# for HTTPS to Hugging Face, libssl3 for the dynamically linked OpenSSL. The
# node image is bookworm, the same Debian release the parsers were built on.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=parsers /out/ /usr/local/bin/
ENV FILL_DB_BIN=/usr/local/bin/fill_db \
    FILL_EVENTS_BIN=/usr/local/bin/fill_events

# The directory layout is load-bearing: config.ts derives PROJECT_ROOT by
# walking four levels up from packages/server/dist and then resolves DATA_DIR
# as ../data -- i.e. /app/data (compose also pins DATA_DIR=/app/data). Do not
# flatten this tree.
WORKDIR /app/gmail-contact-graph/webapp

COPY --from=deps  /app/gmail-contact-graph/webapp/node_modules ./node_modules
COPY --from=build /app/gmail-contact-graph/webapp/package.json ./
COPY --from=build /app/gmail-contact-graph/webapp/packages/shared/package.json ./packages/shared/
COPY --from=build /app/gmail-contact-graph/webapp/packages/server/package.json ./packages/server/
COPY --from=build /app/gmail-contact-graph/webapp/packages/client/package.json ./packages/client/
COPY --from=build /app/gmail-contact-graph/webapp/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/gmail-contact-graph/webapp/packages/server/dist ./packages/server/dist
# app.ts serves static files from __dirname/../../client/dist. Without
# this the API works and the page is blank.
COPY --from=build /app/gmail-contact-graph/webapp/packages/client/dist ./packages/client/dist

COPY docker/webapp-entrypoint.sh /usr/local/bin/webapp-entrypoint.sh
RUN chmod +x /usr/local/bin/webapp-entrypoint.sh

WORKDIR /app/gmail-contact-graph/webapp/packages/server
USER node
ENTRYPOINT ["/usr/local/bin/webapp-entrypoint.sh"]

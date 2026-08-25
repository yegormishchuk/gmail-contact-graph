# syntax=docker/dockerfile:1

# Three independent Cargo packages, each with its own Cargo.lock and target/:
#   gmail-mbox-parser        -> fill_db            (has a lib target too)
#   gmail-mbox-parser/tools  -> generate_rankings  (package "ranking_tools")
#   calendar-parser          -> fill_events
#
# Dependency compilation is cached in IMAGE LAYERS via the manifest-stub
# pattern, not in a --mount=type=cache on target/. A cache mount lives only for
# the duration of its RUN and lands in no layer, so cache-mounting target/ would
# give a colleague, a cold clone or CI no cache at all. rusqlite/bundled
# compiles SQLite from C and the release profile sets lto=true with
# codegen-units=1, so a cold dependency build is minutes -- worth caching
# properly. The registry cache mount below only saves crates.io downloads.
FROM rust:1.87-bookworm AS builder

# reqwest 0.12 default features resolve to native-tls -> openssl-sys, which
# links the SYSTEM OpenSSL. Without these the build fails inside openssl-sys.
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /out

# ---------- fill_db ----------
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

# ---------- generate_rankings ----------
WORKDIR /build/gmail-mbox-parser/tools
COPY gmail-mbox-parser/tools/Cargo.toml gmail-mbox-parser/tools/Cargo.lock ./
RUN mkdir -p src && echo 'fn main(){}' > src/generate_rankings.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    cargo build --release --bin generate_rankings
COPY gmail-mbox-parser/tools/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    touch src/generate_rankings.rs \
    && cargo build --release --bin generate_rankings \
    && cp target/release/generate_rankings /out/generate_rankings

# ---------- fill_events ----------
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

# Runtime MUST stay on bookworm -- the same Debian release as the builder above.
# trixie or alpine gives "GLIBC_2.xx not found" / musl breakage.
FROM debian:bookworm-slim AS runtime

# ca-certificates: HTTPS to the Hugging Face API (optional spam pass).
# libssl3: the native-tls/openssl-sys dynamic link noted above. Without it the
# binary dies with "error while loading shared libraries: libssl.so.3".
# rusqlite's bundled SQLite is static and needs nothing.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/ /usr/local/bin/
COPY docker/parse-entrypoint.sh /usr/local/bin/parse-entrypoint.sh
RUN chmod +x /usr/local/bin/parse-entrypoint.sh

# fill_db and fill_events both call dotenvy::from_path("../.env") at startup
# (fill_db/main.rs:51, fill_events/main.rs:28). With WORKDIR /app/run that
# resolves to /app/.env, which is never created or mounted, so the load fails
# silently and env_file stays the single source of configuration. Do NOT bind
# mount .env at /app -- it would become a second, higher-precedence source.
WORKDIR /app/run

ENTRYPOINT ["/usr/local/bin/parse-entrypoint.sh"]

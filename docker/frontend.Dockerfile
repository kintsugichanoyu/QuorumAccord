# Build from the repository root: docker build -f docker/frontend.Dockerfile .
FROM rust:1.96-slim-trixie AS mdbook
ENV CARGO_BUILD_JOBS=2
RUN cargo install mdbook --version 0.5.4 --locked

FROM node:24.16.0-trixie-slim AS assets
WORKDIR /src
COPY --from=mdbook /usr/local/cargo/bin/mdbook /usr/local/bin/mdbook
COPY docs/book/package.json docs/book/package-lock.json ./docs/book/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix docs/book ci && npm --prefix frontend ci
COPY docs/book/ ./docs/book/
COPY frontend/ ./frontend/
COPY specs/ ./specs/
COPY sdk/README.md ./sdk/README.md
COPY OPEN_QUESTIONS.md ./OPEN_QUESTIONS.md
COPY ROADMAP.md ./ROADMAP.md
COPY testing/devnet/evidence/ ./testing/devnet/evidence/
RUN npm --prefix frontend run build

FROM rust:1.96-slim-trixie AS server
ENV CARGO_BUILD_JOBS=2
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY programs/quorum-allocation/ ./programs/quorum-allocation/
COPY testing/devnet/programs/mock-oracle/ ./testing/devnet/programs/mock-oracle/
COPY frontend/Cargo.toml ./frontend/Cargo.toml
COPY frontend/src/ ./frontend/src/
RUN cargo build --release --locked -p quorum-web

FROM debian:trixie-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=server /src/target/release/quorum-web /usr/local/bin/quorum-web
COPY --from=assets /src/frontend/dist/ /srv/quorum/
ENV QUORUM_WEB_ADDR=0.0.0.0:3000 \
    QUORUM_WEB_ROOT=/srv/quorum
WORKDIR /srv/quorum
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGINT
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl --fail --silent --output /dev/null http://127.0.0.1:3000/ \
    && curl --fail --silent --output /dev/null http://127.0.0.1:3000/book/workers.html || exit 1
ENTRYPOINT ["/usr/local/bin/quorum-web"]

# Multi-stage build for the quorum worker fleet.
# One image builds both daemons; each process uses its own runtime configuration
# and mounted operator key. Build with the repository root as context.

FROM rust:1.96-slim-trixie AS build
ENV CARGO_BUILD_JOBS=2
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev libudev-dev protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY workers/ ./workers/
WORKDIR /build/workers
RUN cargo build --release --locked --bin quorum-producer --bin quorum-consumer

FROM debian:trixie-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libssl3t64 libudev1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/workers/target/release/quorum-producer /usr/local/bin/quorum-producer
COPY --from=build /build/workers/target/release/quorum-consumer /usr/local/bin/quorum-consumer
ENV RUST_LOG=info
USER 10001:10001
# ENTRYPOINT is chosen per service (quorum-producer | quorum-consumer).
ENTRYPOINT ["/usr/local/bin/quorum-producer"]

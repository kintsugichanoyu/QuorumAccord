# Multi-stage build for the reflect worker fleet.
# One image builds both daemons; the role + driver are selected at runtime by env,
# so a single image powers all ~10 producers and the consumer.

FROM rust:1.96-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev libudev-dev protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY workers/ ./workers/
WORKDIR /build/workers
RUN cargo build --release --bin producer --bin consumer

FROM debian:trixie-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/workers/target/release/producer /usr/local/bin/producer
COPY --from=build /build/workers/target/release/consumer /usr/local/bin/consumer
# ENTRYPOINT is chosen per service in docker-compose (producer | consumer).
ENTRYPOINT ["/usr/local/bin/producer"]

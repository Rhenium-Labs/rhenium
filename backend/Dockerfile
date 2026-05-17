FROM rust:1.85-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libssl3 \
        tesseract-ocr \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system rhenium \
    && useradd --system --gid rhenium --home-dir /app --shell /usr/sbin/nologin rhenium \
    && mkdir -p /app/.cache/kv \
    && chown -R rhenium:rhenium /app

COPY --from=builder /app/target/release/rhenium /usr/local/bin/rhenium
COPY cfg.global.yml ./cfg.global.yml

ENV RUST_LOG=rhenium=info,serenity=warn
ENV API_PORT=3000

EXPOSE 3000
VOLUME ["/app/.cache"]

ENTRYPOINT ["rhenium"]
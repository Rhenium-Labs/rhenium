FROM node:24.14.0@sha256:3a09aa6354567619221ef6c45a5051b671f953f0a1924d1f819ffb236e520e6b AS base
WORKDIR /rhenium

# Install bun for package management and compilation.
RUN apt-get update && apt-get install -y curl unzip
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install Ffmpeg, openssl, tesseract, and jemalloc.
RUN apt-get update && apt-get install -y ffmpeg openssl tesseract-ocr libjemalloc2 && rm -rf /var/lib/apt/lists/*

FROM base AS release

COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY applications/bot ./applications/bot
COPY packages/database ./packages/database
COPY packages/config ./packages/config
COPY packages/trpc ./packages/trpc

RUN bun install
RUN bun run compile

WORKDIR /rhenium/applications/bot
EXPOSE 3000

# jemalloc replaces glibc's default allocator (reduces RSS fragmentation by 20-50%).
# dirty_decay_ms / muzzy_decay_ms: return freed pages to OS after 5s instead of holding them.
# background_thread: enables async purging so page returns don't stall the main thread.
ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2
ENV MALLOC_CONF="dirty_decay_ms:5000,muzzy_decay_ms:5000,background_thread:true"

ENTRYPOINT ["node", "--optimize-for-size", "dist/index.js"]

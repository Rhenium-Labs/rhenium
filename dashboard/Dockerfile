FROM node:24.14.0@sha256:3a09aa6354567619221ef6c45a5051b671f953f0a1924d1f819ffb236e520e6b AS base
WORKDIR /rhenium

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip \
    && curl -fsSL https://bun.sh/install | bash \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.bun/bin:${PATH}"

FROM base AS release

COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY dashboard ./dashboard
COPY packages/database ./packages/database
COPY packages/config ./packages/config

RUN bun install

# Compile shared TS packages.
RUN bun x turbo run compile

# Build the dashboard.
WORKDIR /rhenium/dashboard
RUN bun run build

EXPOSE 3000
ENTRYPOINT ["bun", "run", "build/index.js"]

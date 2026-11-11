FROM node:26.13.1@sha256:e18c3ccdf7d71619990b0e85639f506e2028a95410999cab24cc373cbd10e0ac AS base
WORKDIR /rhenium

# Install bun.
RUN apt-get update && apt-get install -y curl unzip
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

FROM base AS release

# Copy only the necessary files.
COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY applications/dashboard ./applications/dashboard
COPY packages/database ./packages/database
COPY packages/config ./packages/config
COPY packages/trpc ./packages/trpc

# Install dependencies.
RUN bun install

# Compile dependencies.
RUN bun run compile

# Build dashboard.
WORKDIR /rhenium/applications/dashboard
RUN bun run build

# Run the dashboard.
EXPOSE 3000
ENTRYPOINT [ "bun", "run", "build/index.js" ]

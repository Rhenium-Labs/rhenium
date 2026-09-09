FROM node:24.21.0@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0 AS base
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

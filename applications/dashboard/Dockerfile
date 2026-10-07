FROM node:24.21.0@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0 AS base
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

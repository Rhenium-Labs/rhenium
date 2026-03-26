FROM node:24.14.1@sha256:bb20cf73b3ad7212834ec48e2174cdcb5775f6550510a5336b842ae32741ce6c AS base
WORKDIR /rhenium

# Install bun.
RUN apt-get update && apt-get install -y curl unzip
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install Ffmpeg, openssl, and tesseract.
RUN apt-get update && apt-get install -y ffmpeg openssl tesseract-ocr && rm -rf /var/lib/apt/lists/*

FROM base AS release

# Copy only the necessary files.
COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY applications/bot ./applications/bot
COPY packages/database ./packages/database
COPY packages/config ./packages/config
COPY packages/trpc ./packages/trpc

# Install dependencies.
RUN bun install

# Compile the bot and its dependencies.
RUN bun run compile

# Run the bot.
WORKDIR /rhenium/applications/bot
# Expose the port for the API server.
EXPOSE 3000
ENTRYPOINT ["node", "./dist/index.js"]

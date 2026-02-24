FROM node:24.13.1@sha256:00e9195ebd49985a6da8921f419978d85dfe354589755192dc090425ce4da2f7 AS base
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

# Install dependencies.
RUN bun install

# Run the bot.
WORKDIR /rhenium/applications/bot
CMD ["bun", "run", "src/index.ts"]

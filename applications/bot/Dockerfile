FROM node:24.15.0@sha256:e9891237dfbb1de60ce19e9ff9fac5d73ad9c37da303ad72ff2a425ad1057e71 AS base
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
ENTRYPOINT ["bun", "run", "./dist/index.js"]

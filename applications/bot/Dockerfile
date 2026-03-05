FROM node:24.14.0@sha256:3a09aa6354567619221ef6c45a5051b671f953f0a1924d1f819ffb236e520e6b AS base
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

# Run the bot.
WORKDIR /rhenium/applications/bot
EXPOSE 3000
ENTRYPOINT ["bun", "run", "src/index.ts"]

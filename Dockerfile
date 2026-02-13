FROM node:24.13.1@sha256:00e9195ebd49985a6da8921f419978d85dfe354589755192dc090425ce4da2f7 AS base
WORKDIR /rhenium

# Install bun
RUN apt-get update && apt-get install -y curl unzip
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install Ffmpeg, openssl, and tesseract.
RUN apt-get update && apt-get install -y ffmpeg openssl tesseract-ocr && rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the project
FROM base AS build
COPY . .
COPY --from=install /rhenium/node_modules node_modules
RUN bun run compile

# Final stage
FROM base AS release
COPY --from=build /rhenium/node_modules ./node_modules
COPY --from=install /rhenium/package.json ./package.json
COPY --from=build /rhenium/dist ./dist
COPY --from=build /rhenium/src ./src
COPY --from=build /rhenium/prisma ./prisma
COPY --from=build /rhenium/tests ./tests

CMD ["bun", "run", "dist/index.js"]
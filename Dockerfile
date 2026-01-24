FROM node:24.13.0@sha256:b2b2184ba9b78c022e1d6a7924ec6fba577adf28f15c9d9c457730cc4ad3807a AS base
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

CMD ["bun", "start"]
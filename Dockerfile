FROM node:24.12.0 AS base
WORKDIR /ssv3

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
COPY --from=install /ssv3/node_modules node_modules
RUN bun run compile

# Final stage
FROM base AS release
COPY --from=build /ssv3/node_modules ./node_modules
COPY --from=install /ssv3/package.json ./package.json
COPY --from=build /ssv3/dist ./dist
COPY --from=build /ssv3/src ./src
COPY --from=build /ssv3/prisma ./prisma
COPY --from=build /ssv3/tests ./tests

CMD ["bun", "start"]
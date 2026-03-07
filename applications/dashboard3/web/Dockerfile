FROM oven/bun:1.3 AS build
WORKDIR /rhenium

# Install dependencies
COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY applications/dashboard/web/package.json ./applications/dashboard/web/
COPY applications/dashboard/server/package.json ./applications/dashboard/server/
COPY packages/database/package.json ./packages/database/
COPY packages/config/package.json ./packages/config/
RUN bun install --frozen-lockfile

# Copy source
COPY packages/database ./packages/database
COPY packages/config ./packages/config
COPY applications/dashboard/server ./applications/dashboard/server
COPY applications/dashboard/web ./applications/dashboard/web

# Build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /rhenium/applications/dashboard/web
RUN bun run build

# Serve with nginx
FROM nginx:alpine
COPY --from=build /rhenium/applications/dashboard/web/dist /usr/share/nginx/html
COPY applications/dashboard/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/health || exit 1

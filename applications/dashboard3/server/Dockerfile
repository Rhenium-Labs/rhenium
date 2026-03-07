FROM oven/bun:1.3 AS base
WORKDIR /rhenium

# Install dependencies
COPY package.json bun.lock tsconfig.base.json turbo.json ./
COPY applications/dashboard/server/package.json ./applications/dashboard/server/
COPY packages/database/package.json ./packages/database/
COPY packages/config/package.json ./packages/config/
RUN bun install --frozen-lockfile

# Copy source
COPY packages/database ./packages/database
COPY packages/config ./packages/config
COPY applications/dashboard/server ./applications/dashboard/server

# Build
WORKDIR /rhenium/applications/dashboard/server
RUN bun run build

# Production
FROM oven/bun:1.3-slim
WORKDIR /app
COPY --from=base /rhenium/applications/dashboard/server/dist ./dist
COPY --from=base /rhenium/node_modules ./node_modules
COPY --from=base /rhenium/packages ./packages
COPY --from=base /rhenium/applications/dashboard/server/package.json ./

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://localhost:4000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["bun", "run", "start"]

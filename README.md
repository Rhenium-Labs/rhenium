# Rhenium

Originally built for the [Brawl Stars Discord Server](https://discord.com/brawlstars), Rhenium is an AI-powered moderation bot designed to be simple, fast, and reliable. Built _by moderators, for moderators_, it focuses on reducing manual workload while keeping communities safe and easy to manage.

## Project Structure

```
rhenium/
├── applications/
│   ├── bot/                    # Discord bot (Bun)
│   └── dashboard/
│       ├── server/             # Dashboard API (Hono + tRPC + Bun)
│       └── web/                # Dashboard Frontend (React + Vite)
├── packages/
│   ├── config/                 # Shared config types & schemas
│   └── database/               # Prisma schema + Kysely types
├── turbo.json                  # Turborepo task config
├── docker-compose.yml          # Docker Compose for all services
└── package.json                # Root workspace
```

## Prerequisites

- [Bun](https://bun.sh/) >= 1.3
- [Node.js](https://nodejs.org/) >= 20 (for Prisma CLI)
- PostgreSQL database (or [Neon](https://neon.tech/))

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Environment variables

Create a `.env` file in **`applications/dashboard/server/`**:

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Auth
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d

# Discord OAuth2
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_REDIRECT_URI=http://localhost:5173/login/callback
BOT_TOKEN=your-bot-token

# Server
PORT=4000
CORS_ORIGIN=http://localhost:5173
```

Create a `.env` file in **`applications/dashboard/web/`**:

```env
VITE_API_URL=http://localhost:4000/api/v1
```

### 3. Database

```bash
# Apply migrations
bun run db:migrate

# Generate Kysely types (after schema changes)
bun run db:generate
```

### 4. Development

```bash
# Run all services in parallel (via Turborepo)
bun run dev

# Or run individually
cd applications/dashboard/server && bun run dev
cd applications/dashboard/web && bun run dev
```

### 5. Build

```bash
# Build all packages & apps
bun run build
```

### 6. Docker

```bash
# Start all services
docker compose up -d

# With Docker Swarm
docker stack deploy -c docker-compose.yml rhenium
```

## Contributing

See the [Contributing Guide](./CONTRIBUTING.md) to get started.

## License

Rhenium is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** license. For full details, see the [LICENSE](./LICENSE) file.

# Server Plan

Dashboard API server built on Hono + tRPC + Kysely (Postgres), running on Bun.

## Architecture

```
Hono HTTP layer
  ├── /api/v1/auth/*          REST routes (Discord OAuth2 login/callback)
  └── /api/v1/trpc/*          tRPC handler
        ├── auth.me            Current user + whitelist
        ├── guild.*            Guild listing, user guilds, channels, roles, feature status
        ├── whitelist.*        Developer-only guild whitelist management
        ├── messageReports.*   Message reports config + blacklist
        ├── banRequests.*      Ban requests config
        ├── contentFilter.*    Content filter config + channel scoping
        ├── highlights.*       Highlights config
        ├── quickMutes.*       Quick mutes config + channel scoping
        ├── quickPurges.*      Quick purges config + channel scoping
        ├── logging.*          Logging webhook CRUD
        └── temporaryBans.*    Read-only temp ban list
```

## Error Handling (Go-style)

All functions return `Result<T>` tuples: `[data, null]` on success, `[null, error]` on failure.

- `src/types/result.ts` — `Result<T>`, `AppError`, `ok()`, `err()` helpers
- `src/utils/safe.ts` — `safeQuery()` wraps Kysely, `safeFetch()` wraps HTTP calls. These are the **only** places `try/catch` is used.
- `ErrorBuilder` gains `.toResult()` and `.toAppError()` for value-based errors
- `ErrorBuilder.*.throw()` is only called at the **tRPC boundary** (inside router handlers) after checking result tuples
- Middleware (`authMiddleware`, `devMiddleware`, `guildMiddleware`) still use `.throw()` since tRPC middleware requires thrown errors for control flow

### Pattern

```ts
const [data, queryErr] = await safeQuery(() => db.selectFrom(...).execute())
if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()
if (!data) ErrorBuilder.notFound('Not found').throw()
return data
```

## Auth Flow

1. `GET /api/v1/auth/discord` → redirect to Discord OAuth2
2. `GET /api/v1/auth/discord/callback?code=...` → exchange code for tokens, fetch user, store session in DB, return JWT
3. JWT (HS256, jose) carries `{ sub, username, avatar }`, expires per `JWT_EXPIRES_IN`
4. Discord access/refresh tokens stored in `sessions` table for later API calls (guild listing)

## Database Tables

| Table | Purpose |
|-------|---------|
| `sessions` | Discord OAuth tokens per user (for fetching guilds) |
| `whitelist` | Whitelisted guild IDs |
| `message_reports_config` | Message reports settings |
| `ban_requests_config` | Ban requests settings |
| `content_filter_config` | Content filter settings |
| `content_filter_channel_scoping` | Content filter per-channel overrides |
| `highlights_config` | Highlights settings |
| `quick_mutes_config` | Quick mutes settings |
| `quick_mutes_channel_scoping` | Quick mutes per-channel overrides |
| `quick_purges_config` | Quick purges settings |
| `quick_purges_channel_scoping` | Quick purges per-channel overrides |
| `logging_webhooks` | Logging webhook configs |
| `temporary_bans` | Active temporary bans |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `JWT_EXPIRES_IN` | No | `7d` | JWT expiry duration |
| `DISCORD_CLIENT_ID` | Yes | — | Discord OAuth app client ID |
| `DISCORD_CLIENT_SECRET` | Yes | — | Discord OAuth app client secret |
| `DISCORD_REDIRECT_URI` | Yes | — | OAuth callback URL |
| `BOT_TOKEN` | Yes | — | Discord bot token (for channels/roles/webhooks) |
| `DEVELOPER_IDS` | No | — | Comma-separated Discord user IDs for dev access |
| `PORT` | No | `4000` | Server port |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin |

## Key Files

| File | Purpose |
|------|---------|
| `src/types/result.ts` | Result tuple type + helpers |
| `src/utils/safe.ts` | safeQuery, safeFetch, safeParse wrappers |
| `src/utils/discord.ts` | Discord API calls (all return Result) |
| `src/utils/discord-session.ts` | Discord token retrieval + refresh |
| `src/utils/webhook.ts` | Discord webhook operations (all return Result) |
| `src/errors/builder.ts` | ErrorBuilder with .throw(), .toResult(), .toAppError() |
| `src/routes/auth.ts` | REST auth routes |
| `src/routers/*.ts` | tRPC routers (Go-style error handling) |
| `src/trpc/guild.ts` | Guild middleware + procedure |
| `src/trpc/procedures.ts` | Auth/dev middleware + base procedures |

## SQL: Create sessions table

```sql
CREATE TABLE sessions (
    user_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

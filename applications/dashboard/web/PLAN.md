# Web Plan

Dashboard SPA built on React 19 + Vite 7 + Tailwind v4 + tRPC + Zustand.

## Architecture

```
React Router v7
  ├── /                          Login page (unauthenticated) or redirect to /home
  ├── /login/callback            OAuth callback → store JWT + redirect
  ├── /home                      Guild selection grid (protected)
  ├── /guilds/:guildId           Guild dashboard — feature overview cards (protected)
  └── /guilds/:guildId/settings  Guild settings (protected)
        ├── /message-reports     Message Reports config
        ├── /ban-requests        Ban Requests config
        ├── /content-filter      Content Filter config + channel scoping
        ├── /highlights          Highlights config
        ├── /quick-mutes         Quick Mutes config + channel scoping
        ├── /quick-purges        Quick Purges config + channel scoping
        ├── /logging             Logging webhook management
        └── /temporary-bans      Temporary bans list
```

## State Management

| Store/Context | Location | Purpose |
|---------------|----------|---------|
| `useAuthStore` | `stores/auth.ts` | JWT token + user info (persisted) |
| `useGuildStore` | `stores/guild.ts` | Selected guild id/name/icon (persisted) |
| `GuildContext` | `contexts/GuildContext.tsx` | Current guild feature data from `guild.get` query |
| `UserSettingsContext` | `contexts/UserSettingsContext.tsx` | Settings modal open/close state |
| `ThemeProvider` | `components/theme/ThemeProvider.tsx` | Light/dark theme |

## Pages

| Page | File | Description |
|------|------|-------------|
| HomePage | `pages/HomePage.tsx` | Login landing with Discord OAuth button |
| LoginCallbackPage | `pages/LoginCallbackPage.tsx` | OAuth code exchange, stores JWT |
| GuildSelectPage | `pages/GuildSelectPage.tsx` | Grid of user's manageable guilds, split by whitelist status |
| GuildDashboardPage | `pages/GuildDashboardPage.tsx` | Feature overview cards with enabled/disabled badges |
| MessageReportsPage | `pages/features/MessageReportsPage.tsx` | Config form with toggles, channel/role selectors |
| BanRequestsPage | `pages/features/BanRequestsPage.tsx` | Config form for ban request settings |
| ContentFilterPage | `pages/features/ContentFilterPage.tsx` | Config form + channel scoping table |
| HighlightsPage | `pages/features/HighlightsPage.tsx` | Enable toggle + max patterns input |
| QuickMutesPage | `pages/features/QuickMutesPage.tsx` | Config form + channel scoping table |
| QuickPurgesPage | `pages/features/QuickPurgesPage.tsx` | Config form + channel scoping table |
| LoggingPage | `pages/features/LoggingPage.tsx` | Webhook CRUD with event selector |
| TemporaryBansPage | `pages/features/TemporaryBansPage.tsx` | Read-only list of active temp bans |

## Components

### Layout

| Component | File | Description |
|-----------|------|-------------|
| DashboardLayout | `components/layout/DashboardLayout.tsx` | Full-screen Discord-style layout with sidebar |
| Sidebar | `components/layout/Sidebar/index.tsx` | ServerStrip + ChannelPanel + UserSection |
| ServerStrip | `components/layout/Sidebar/ServerStrip.tsx` | Real guild icons from `guild.userGuilds` |
| ChannelPanel | `components/layout/Sidebar/ChannelPanel.tsx` | Guild nav + feature list when in settings |
| UserSection | `components/layout/UserSection.tsx` | User avatar + settings button |
| GuildSettingsLayout | `components/guild/GuildSettingsLayout.tsx` | Feature nav sidebar + content area |

### Form Components (`components/form/`)

| Component | Description |
|-----------|-------------|
| `ToggleSwitch` | On/off switch with label and description |
| `ChannelSelect` | Dropdown of guild channels from `guild.channels` |
| `RoleSelect` | Multi-select role chips from `guild.roles` |
| `NumberInput` | Labeled number input with min/max |
| `ConfigForm` | Generic form wrapper with dirty tracking, save/reset bar |
| `DataTable` | Reusable table for lists (channel scoping, webhooks, bans) |

### UI Components

| Component | Description |
|-----------|-------------|
| `FeatureCard` | Card with name, description, enabled badge |
| `BaseModal` | Portal-based modal with close button |
| `BaseIcon` | Server/app icon with active state |
| `Button` | CVA button with variants |
| `LoadingScreen` | Full-screen loading with logo animation |

## API Integration

All data fetching uses tRPC via `@trpc/react-query`:

```ts
// Query
const { data, isLoading, error, refetch } = useGet(trpc.guild.userGuilds, undefined)

// Mutation (update)
const { triggerPatch, isPatching } = usePatch(trpc.messageReports.updateConfig, {
    invalidate: (u) => u.messageReports.getConfig.invalidate({ guildId }),
})

// Mutation (create)
const { triggerPost, isPosting } = usePost(trpc.logging.create, {
    invalidate: (u) => u.logging.list.invalidate({ guildId }),
})

// Mutation (delete)
const { triggerDelete } = useDelete(trpc.logging.delete, {
    invalidate: (u) => u.logging.list.invalidate({ guildId }),
})
```

## Styling

- Tailwind CSS v4 with Shadcn
- Discord-themed CSS variables (sidebar, panel, main, divider, hover, blurple, success, muted)
- Light/dark theme support via ThemeProvider
- `cn()` utility (clsx + tailwind-merge)

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend server URL (e.g. `http://localhost:4000`) |

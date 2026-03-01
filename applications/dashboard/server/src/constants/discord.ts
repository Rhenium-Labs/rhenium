export const DISCORD = {
    API_BASE: 'https://discord.com/api/v10',
    CDN_BASE: 'https://cdn.discordapp.com',
    OAUTH2_AUTHORIZE_URL: 'https://discord.com/api/oauth2/authorize',
    OAUTH2_TOKEN_URL: 'https://discord.com/api/oauth2/token',
    OAUTH2_REVOKE_URL: 'https://discord.com/api/oauth2/token/revoke',
    WEBHOOK_URL_PATTERN: /^https:\/\/discord\.com\/api\/webhooks\/\d+\/.+$/,
    PERMISSIONS: {
        MANAGE_GUILD: 0x20,
    },
    OAUTH2_SCOPES: ['identify', 'guilds'],
} as const

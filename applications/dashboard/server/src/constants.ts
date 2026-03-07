export const DISCORD = {
    API_BASE: 'https://discord.com/api/v10',
    CDN_BASE: 'https://cdn.discordapp.com',
    OAUTH2_AUTHORIZE_URL: 'https://discord.com/api/oauth2/authorize',
    OAUTH2_TOKEN_URL: 'https://discord.com/api/oauth2/token',
    OAUTH2_REVOKE_URL: 'https://discord.com/api/oauth2/token/revoke',
    WEBHOOK_URL_PATTERN: /^https:\/\/discord\.com\/api\/webhooks\/\d+\/.+$/,
    PERMISSIONS: {
        MANAGE_GUILD: 0x20,
        ADMINISTRATOR: 0x8,
    },
    OAUTH2_SCOPES: ['identify', 'guilds'],
} as const

export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
} as const
export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS]

export const ERROR_CODES = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    WEBHOOK_ERROR: 'WEBHOOK_ERROR',
} as const
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export const LIMITS = {
    HIGHLIGHT_PATTERN_MAX_LENGTH: 45,
    HIGHLIGHT_MAX_PATTERNS: { MIN: 1, MAX: 30 },
    QUICK_REACTION_MAX_PER_USER: 10,
    QUICK_MUTE_DURATION_MS: { MIN: 5_000, MAX: 2_419_200_000 },
    PURGE_LIMIT: { MIN: 2, MAX: 500 },
    BAN_DURATION_MS: { MIN: 1_000, MAX: 157_680_000_000 },
} as const

export const RATE_LIMIT = {
    STANDARD: { MAX_REQUESTS: 30, WINDOW_MS: 60_000 },
    STRICT: { MAX_REQUESTS: 5, WINDOW_MS: 60_000 },
    PUBLIC: { MAX_REQUESTS: 15, WINDOW_MS: 60_000 },
    CLEANUP_INTERVAL_MS: 60_000,
} as const

export const CACHE = {
    DEFAULT_TTL_MS: 30_000,
    CLEANUP_INTERVAL_MS: 60_000,
} as const

export const JWT = {
    ALGORITHM: 'HS256' as const,
    DEFAULT_EXPIRES_IN: '7d',
    BEARER_PREFIX: 'Bearer ',
} as const

export const API = {
    PREFIX: '/api/v1',
    TRPC_PREFIX: '/api/v1/trpc',
    AUTH_PREFIX: '/api/v1/auth',
} as const

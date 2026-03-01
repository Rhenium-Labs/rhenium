function required(key: string): string {
    const value = process.env[key]
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`)
    }
    return value
}

function optional(key: string): string | undefined {
    return process.env[key]
}

export const env = {
    get database() {
        return {
            url: required('DATABASE_URL'),
        }
    },

    get jwt() {
        return {
            secret: required('JWT_SECRET'),
            expiresIn: optional('JWT_EXPIRES_IN') ?? '7d',
        }
    },

    get discord() {
        return {
            clientId: required('DISCORD_CLIENT_ID'),
            clientSecret: required('DISCORD_CLIENT_SECRET'),
            redirectUri: required('DISCORD_REDIRECT_URI'),
            // botToken: required('BOT_TOKEN'),
        }
    },

    get developers() {
        return optional('DEVELOPER_IDS')?.split(',').filter(Boolean) ?? []
    },

    get server() {
        return {
            port: Number(optional('PORT') ?? '4000'),
            corsOrigin: optional('CORS_ORIGIN') ?? 'http://localhost:5173',
        }
    },
} as const

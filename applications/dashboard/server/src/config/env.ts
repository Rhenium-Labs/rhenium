import { z } from "zod"

export const env = z
  .object({
    DATABASE_URL: z.string().min(1),

    JWT_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string().default("7d"),

    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_CLIENT_SECRET: z.string().min(1),
    DISCORD_REDIRECT_URI: z.string().min(1),
    BOT_TOKEN: z.string().min(1),

    PORT: z.coerce.number().default(4000),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
  })
  .transform((v) => ({
    database: {
      url: v.DATABASE_URL,
    },
    jwt: {
      secret: v.JWT_SECRET,
      expiresIn: v.JWT_EXPIRES_IN,
    },
    discord: {
      clientId: v.DISCORD_CLIENT_ID,
      clientSecret: v.DISCORD_CLIENT_SECRET,
      redirectUri: v.DISCORD_REDIRECT_URI,
      botToken: v.BOT_TOKEN,
    },
    server: {
      port: v.PORT,
      corsOrigin: v.CORS_ORIGIN,
    },
  }))
  .parse(process.env)
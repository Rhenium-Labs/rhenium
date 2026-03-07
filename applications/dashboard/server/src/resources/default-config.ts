import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_GUILD_CONFIG, GUILD_CONFIG_SCHEMA, type RawGuildConfig } from '@repo/config'

let cached: RawGuildConfig | null = null

export function getDefaultGuildConfig(): RawGuildConfig {
    if (cached) return cached

    try {
        const filePath = path.join(__dirname, 'defaultGuildConfig.json')
        const raw = fs.readFileSync(filePath, 'utf8')
        const parsed = JSON.parse(raw)

        cached = GUILD_CONFIG_SCHEMA.parse(parsed)
        return cached
    } catch {
        // If the resource file is missing or invalid, fall back to the
        // compile-time default from @repo/config so the server still works.
        cached = DEFAULT_GUILD_CONFIG
        return DEFAULT_GUILD_CONFIG
    }
}


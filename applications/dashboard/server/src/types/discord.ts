export interface DiscordUser {
    id: string
    username: string
    avatar: string | null
}

export interface DiscordGuild {
    id: string
    name: string
    icon: string | null
    permissions: number
}

export interface DiscordChannel {
    id: string
    name: string
    type: number
    parent_id: string | null
    position: number
}

export interface DiscordRole {
    id: string
    name: string
    color: number
    position: number
    permissions: string
}

export interface DiscordEmoji {
    id: string
    name: string
    animated: boolean
}

export interface DiscordTokenResponse {
    access_token: string
    refresh_token: string
    expires_in: number
}

import { env } from "$env/dynamic/private";
import type { ChannelInfo, RoleInfo } from "$utils/Types";

import KeyValueStore from "./KVStore";

type BotApiScope = {
	guildId: string;
	userId: string;
};

type CreateWebhookOptions = BotApiScope & {
	channelId: string;
	existingUrl?: string;
};

type DeleteWebhookOptions = BotApiScope & {
	webhookUrl: string;
};

type QueryGuildOptions = BotApiScope & {
	forceRefresh?: boolean;
};

/**
 * Server-side client for the Rust bot's REST API.
 */
export default class BotApi {
	private static readonly _defaultBaseUrl = "http://localhost:3000";
	private static readonly _cacheTtlSeconds = 60;

	/**
	 * Returns whether the given user is configured as a bot developer.
	 *
	 * @param userId Discord user ID.
	 * @returns True when the user is a configured developer.
	 */
	static async isDeveloper(userId: string): Promise<boolean> {
		const result = await this._get<{ isDeveloper: boolean }>(`/developers/${userId}/verify`, {
			guildId: userId,
			userId
		});

		return result.isDeveloper;
	}

	/**
	 * Fetches a guild's Discord roles from the bot.
	 *
	 * @param options Guild/user scope and optional cache control.
	 * @returns Discord roles visible to the bot.
	 */
	static async getGuildRoles(options: QueryGuildOptions): Promise<RoleInfo[]> {
		const { guildId, forceRefresh = false } = options;
		const cacheKey = `guild_roles:${guildId}`;

		if (!forceRefresh) {
			const cached = KeyValueStore.get<RoleInfo[]>(cacheKey);
			if (cached) return cached;
		}

		const roles = await this._get<RoleInfo[]>(`/guilds/${guildId}/roles`, options).catch(
			() => []
		);

		KeyValueStore.set(cacheKey, roles, this._cacheTtlSeconds);
		return roles;
	}

	/**
	 * Fetches a guild's Discord channels from the bot.
	 *
	 * @param options Guild/user scope and optional cache control.
	 * @returns Discord channels visible to the bot.
	 */
	static async getGuildChannels(options: QueryGuildOptions): Promise<ChannelInfo[]> {
		const { guildId, forceRefresh = false } = options;
		const cacheKey = `guild_channels:${guildId}`;

		if (!forceRefresh) {
			const cached = KeyValueStore.get<ChannelInfo[]>(cacheKey);
			if (cached) return cached;
		}

		const channels = await this._get<ChannelInfo[]>(
			`/guilds/${guildId}/channels`,
			options
		).catch(() => []);

		KeyValueStore.set(cacheKey, channels, this._cacheTtlSeconds);
		return channels;
	}

	/**
	 * Invalidates the bot's cached guild configuration.
	 *
	 * @param options Guild/user scope.
	 */
	static async invalidateConfigCache(options: BotApiScope): Promise<void> {
		const { guildId } = options;
		await this._post<{ success: boolean }>(`/guilds/${guildId}/config/invalidate`, options);
	}

	/**
	 * Creates or moves a Discord webhook through the bot.
	 *
	 * @param options Guild/user scope and webhook channel details.
	 * @returns The webhook URL.
	 */
	static async createWebhook(options: CreateWebhookOptions): Promise<{ url: string }> {
		const { guildId, channelId, existingUrl } = options;

		return this._post<{ url: string }>(`/guilds/${guildId}/webhooks`, options, {
			channelId,
			existingUrl
		});
	}

	/**
	 * Deletes a Discord webhook through the bot.
	 *
	 * @param options Guild/user scope and webhook URL.
	 */
	static async deleteWebhook(options: DeleteWebhookOptions): Promise<void> {
		const { guildId, webhookUrl } = options;
		await this._delete<void>(`/guilds/${guildId}/webhooks`, options, { webhookUrl });
	}

	private static async _get<T>(path: string, scope: BotApiScope): Promise<T> {
		return this._request<T>(path, scope, { method: "GET" });
	}

	private static async _post<T>(path: string, scope: BotApiScope, body?: unknown): Promise<T> {
		return this._request<T>(path, scope, { method: "POST", body });
	}

	private static async _delete<T>(path: string, scope: BotApiScope, body?: unknown): Promise<T> {
		return this._request<T>(path, scope, { method: "DELETE", body });
	}

	private static async _request<T>(
		path: string,
		scope: BotApiScope,
		options: { method: "GET" | "POST" | "DELETE"; body?: unknown }
	): Promise<T> {
		const secret = env.API_SECRET ?? "";

		if (!secret) {
			throw new Error("Missing API_SECRET for bot API authentication.");
		}

		const response = await fetch(`${this._baseUrl}${path}`, {
			method: options.method,
			headers: {
				authorization: `Bearer ${secret}`,
				"x-guild-id": scope.guildId,
				"x-user-id": scope.userId,
				...(options.body === undefined ? {} : { "content-type": "application/json" })
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body)
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(
				`Bot API ${options.method} ${path} failed with ${response.status}${detail ? `: ${detail}` : ""}`
			);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		return response.json() as Promise<T>;
	}

	private static get _baseUrl(): string {
		return (env.BOT_API_URL ?? this._defaultBaseUrl).replace(/\/+$/, "");
	}
}

export const queryGuildRoles = BotApi.getGuildRoles.bind(BotApi);
export const queryGuildChannels = BotApi.getGuildChannels.bind(BotApi);

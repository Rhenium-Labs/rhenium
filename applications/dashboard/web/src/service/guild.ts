import { useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useGuildConfigStore } from "@/stores/guild-config";
import { useDiscordCacheStore } from "@/stores/discord-cache";

function useUserGuilds() {
	const query = trpc.guild.userGuilds.useQuery(undefined, {
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const setConfigs = useGuildConfigStore((s) => s.setConfigs);

	useEffect(() => {
		if (query.error) console.error("[GuildService.useUserGuilds]", query.error);
	}, [query.error]);

	useEffect(() => {
		const payload = query.data;
		if (payload?.configs) {
			setConfigs(payload.configs);
		}
	}, [query.data, setConfigs]);

	return {
		data: query.data?.guilds ?? null,
		guilds: query.data?.guilds ?? null,
		configs: query.data?.configs ?? null,
		isLoading: query.isLoading,
		error: query.error?.message,
		refetch: query.refetch,
	};
}

function useGet(guildId: string) {
	const query = trpc.guild.get.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[GuildService.useGet]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
		refetch: query.refetch,
	};
}

/** Fetch channels from Discord API on demand, caching results in Zustand. */
function useChannels(guildId: string) {
	const cache = useDiscordCacheStore((s) => s.channels[guildId]);
	const setChannels = useDiscordCacheStore((s) => s.setChannels);

	const query = trpc.guild.channels.useQuery(
		{ guildId },
		{ enabled: false },
	);

	useEffect(() => {
		if (query.data) setChannels(guildId, query.data);
	}, [query.data, guildId, setChannels]);

	const fetch = useCallback(() => {
		query.refetch();
	}, [query]);

	return {
		data: query.data ?? cache?.data,
		isLoading: query.isLoading && query.fetchStatus === "fetching",
		fetch,
	};
}

/** Fetch roles from Discord API on demand, caching results in Zustand. */
function useRoles(guildId: string) {
	const cache = useDiscordCacheStore((s) => s.roles[guildId]);
	const setRoles = useDiscordCacheStore((s) => s.setRoles);

	const query = trpc.guild.roles.useQuery(
		{ guildId },
		{ enabled: false },
	);

	useEffect(() => {
		if (query.data) setRoles(guildId, query.data);
	}, [query.data, guildId, setRoles]);

	const fetch = useCallback(() => {
		query.refetch();
	}, [query]);

	return {
		data: query.data ?? cache?.data,
		isLoading: query.isLoading && query.fetchStatus === "fetching",
		fetch,
	};
}

/** Pre-fetch channel names from DB cache (no Discord API call). */
function useCachedChannels(guildId: string) {
	const setChannels = useDiscordCacheStore((s) => s.setChannels);
	const existing = useDiscordCacheStore((s) => s.channels[guildId]);

	const query = trpc.guild.cachedChannels.useQuery(
		{ guildId },
		{
			enabled: !existing,
			staleTime: Infinity,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	);

	useEffect(() => {
		if (query.data && !existing) {
			setChannels(guildId, query.data.map((c) => ({
				id: c.id,
				name: c.name,
				type: 0,
				parent_id: null,
				position: 0,
			})));
		}
	}, [query.data, existing, guildId, setChannels]);
}

/** Pre-fetch role names from DB cache (no Discord API call). */
function useCachedRoles(guildId: string) {
	const setRoles = useDiscordCacheStore((s) => s.setRoles);
	const existing = useDiscordCacheStore((s) => s.roles[guildId]);

	const query = trpc.guild.cachedRoles.useQuery(
		{ guildId },
		{
			enabled: !existing,
			staleTime: Infinity,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	);

	useEffect(() => {
		if (query.data && !existing) {
			setRoles(guildId, query.data.map((r) => ({
				id: r.id,
				name: r.name,
				color: r.color,
				position: 0,
			})));
		}
	}, [query.data, existing, guildId, setRoles]);
}

export const GuildService = {
	useUserGuilds,
	useGet,
	useChannels,
	useRoles,
	useCachedChannels,
	useCachedRoles,
} as const;

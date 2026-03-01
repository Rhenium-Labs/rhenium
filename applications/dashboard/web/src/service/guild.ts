import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useUserGuilds() {
	const query = trpc.guild.userGuilds.useQuery();

	useEffect(() => {
		if (query.error) console.error("[GuildService.useUserGuilds]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
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

function useChannels(guildId: string) {
	const query = trpc.guild.channels.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[GuildService.useChannels]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
	};
}

function useRoles(guildId: string) {
	const query = trpc.guild.roles.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[GuildService.useRoles]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
	};
}

export const GuildService = {
	useUserGuilds,
	useGet,
	useChannels,
	useRoles,
} as const;

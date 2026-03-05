import type { PageServerLoad } from "./$types";
import { queryGuildChannels, queryGuildRoles } from "$utils/server/TRPC";

export const load: PageServerLoad = async ({ parent }) => {
	const { session, guild } = await parent();
	const [channels, roles] = await Promise.all([
		queryGuildChannels({ guildId: guild.id, userId: session.userId }),
		queryGuildRoles({ guildId: guild.id, userId: session.userId })
	]);

	return { channels, roles };
};

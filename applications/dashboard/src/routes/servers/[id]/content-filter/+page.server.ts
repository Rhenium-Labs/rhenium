import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { queryGuildChannels, queryGuildRoles } from "$utils/server/TRPC";

export const load: PageServerLoad = async ({ parent }) => {
	const { session, guild } = await parent();

	if (!guild.contentFilterWhitelisted) {
		error(403, {
			message: "Content Filter Unavailable",
			description: "This server is not whitelisted for the AI content filter system."
		});
	}

	const [channels, roles] = await Promise.all([
		queryGuildChannels({ guildId: guild.id, userId: session.userId }),
		queryGuildRoles({ guildId: guild.id, userId: session.userId })
	]);

	return { channels, roles };
};

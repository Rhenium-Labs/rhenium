import type { PageServerLoad } from "./$types";
import { queryGuildRoles } from "$utils/server/TRPC";

export const load: PageServerLoad = async ({ parent }) => {
	const { session, guild } = await parent();

	const roles = await queryGuildRoles({
		guildId: guild.id,
		userId: session.userId
	});

	return { roles };
};

import type { PageServerLoad } from "./$types";
import { safeLoadChannelsAndRoles } from "$lib/server/trpc";

export const load: PageServerLoad = async ({ parent }) => {
	const { session, guild } = await parent();
	const { channels, roles } = await safeLoadChannelsAndRoles(guild.id, session.userId);

	return { channels, roles };
};

import type { PageServerLoad } from "./$types";
import { safeLoadChannels } from "$lib/server/trpc";

export const load: PageServerLoad = async ({ parent }) => {
	const { session, guild } = await parent();
	const channels = await safeLoadChannels(guild.id, session.userId);
	return { channels };
};

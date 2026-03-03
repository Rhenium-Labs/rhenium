import type { PageServerLoad } from "./$types";
import { safeLoadRoles } from "$lib/server/trpc";

export const load: PageServerLoad = async ({ parent }) => {
	const { session, guild } = await parent();
	const roles = await safeLoadRoles(guild.id, session.userId);
	return { roles };
};

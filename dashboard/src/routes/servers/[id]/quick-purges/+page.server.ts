import type { PageServerLoad } from "./$types";
import { queryGuildChannels } from "$utils/server/BotApi";

export const load: PageServerLoad = async ({ parent }) => {
	const { session, guild } = await parent();
	const channels = await queryGuildChannels({
		guildId: guild.id,
		userId: session.userId
	});

	return { channels };
};

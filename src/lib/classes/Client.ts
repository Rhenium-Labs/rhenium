import { Client, Options } from "discord.js";
import { CLIENT_INTENTS, CLIENT_PARTIALS } from "#utils/Constants.js";

/**
 * Modified Discord.js client instance.
 *
 * The caching is heavily limited to reduce memory usage. Relevant data is stored in the database.
 * The client is configured to use privileged intents which you must enable in the Discord Developer Portal.
 */

export default class StrafeStryker extends Client<true> {
	/**
	 * Constructs a new StrafeStryker client.
	 */

	constructor() {
		super({
			intents: CLIENT_INTENTS,
			partials: CLIENT_PARTIALS,
			makeCache: Options.cacheWithLimits({
				GuildBanManager: 0,
				GuildEmojiManager: 0,
				GuildStickerManager: 0,
				GuildMemberManager: Infinity,
				GuildTextThreadManager: 0,
				GuildForumThreadManager: 0,
				GuildInviteManager: 0,
				GuildScheduledEventManager: 0,
				GuildMessageManager: 0,

				ThreadMemberManager: 0,
				VoiceStateManager: 0,
				StageInstanceManager: 0,
				ThreadManager: 0,
				ReactionManager: 0,
				ReactionUserManager: 0,
				MessageManager: 0,

				UserManager: Infinity,
				ApplicationCommandManager: Infinity
			}),
			allowedMentions: { parse: [] }
		});
	}
}

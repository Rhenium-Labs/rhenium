import { GuildMember, User } from "discord.js";

import { client } from "#root/index.js";
import { hierarchyCheck } from "./index.js";

import type { SimpleResult } from "./Types.js";

export default class ModerationUtils {
	/**
	 * Validate a moderation action.
	 *
	 * @param data The moderation action data to validate.
	 * @returns The result of the validation.
	 */

	public static validateAction(data: {
		target: GuildMember | User;
		executor: GuildMember;
		action: "Ban" | "Mute" | "Quick Mute";
	}): SimpleResult {
		const { target, executor, action } = data;
		const actionLower = action.toLowerCase();

		if (target.id === executor.id) {
			return { ok: false, message: `You cannot ${actionLower} yourself.` };
		}

		if (target.id === client.user.id) {
			return { ok: false, message: `You cannot ${actionLower} me.` };
		}

		if (target.id === executor.guild.ownerId) {
			return { ok: false, message: `You cannot ${actionLower} the server owner.` };
		}

		if (target instanceof GuildMember) {
			if (!hierarchyCheck(executor, target)) {
				return { ok: false, message: `You cannot ${actionLower} a member with higher or equal roles.` };
			}

			if (!hierarchyCheck(executor.guild.members.me!, target)) {
				return {
					ok: false,
					message: `I cannot ${actionLower} a member with higher or equal roles than me.`
				};
			}
		}

		return { ok: true };
	}
}

import { GuildMember, type User } from "discord.js";

import { client } from "@root/index";
import { hierarchyCheck } from "./index";

import type { SimpleResult } from "./Types";

export default class ModerationUtils {
	/**
	 * Validate a moderation action.
	 *
	 * @param target The target of the moderation action (the user being moderated).
	 * @param executor The executor of the moderation action (the member performing the moderation).
	 * @param action The type of moderation action being performed (e.g., "Ban", "Mute", "Quick Mute").
	 * @returns The result of the validation.
	 */

	static validateAction(
		target: GuildMember | User,
		executor: GuildMember,
		action: "Ban" | "Mute" | "Quick Mute"
	): SimpleResult {
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
				return {
					ok: false,
					message: `You cannot ${actionLower} a member with higher or equal roles.`
				};
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

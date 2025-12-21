import ms, { StringValue } from "ms";

import type { SimpleResult } from "./Types.js";
import { GuildMember, Snowflake } from "discord.js";

/**
 * Inflects a word based on the count.
 *
 * @param count The count to base the inflection on.
 * @param singular The singular form of the word.
 * @returns The inflected word.
 */

export function inflect(count: number, singular: string, plural = `${singular}s`): string {
	return count === 1 ? singular : plural;
}

/**
 * Wait a certain amount of time before proceeding with the next step.
 *
 * @param ms The amount of time to wait in milliseconds.
 * @returns A promise that resolves after the specified time has elapsed.
 */

export async function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a duration string into a number of milliseconds.
 *
 * @param durationStr The duration string to parse.
 * @returns The duration in milliseconds.
 */

export function parseDurationString(durationStr: string | null): number | null {
	if (!durationStr) return null;

	const numericValue = Number(durationStr);

	if (!isNaN(numericValue)) return numericValue * 1000;
	return ms(durationStr as StringValue) ?? null;
}

/**
 * Validate a duration against optional minimum and maximum values.
 *
 * @param data The duration data to validate.
 * @returns The result of the validation.
 */

export function validateDuration(data: { duration: number; minimum?: string; maximum?: string }): SimpleResult {
	if (data.minimum !== undefined) {
		const minMs = ms(data.minimum as StringValue);

		if (minMs !== undefined && data.duration < minMs) {
			return { ok: false, message: `Duration must be at least ${data.minimum}.` };
		}
	}

	if (data.maximum !== undefined) {
		const maxMs = ms(data.maximum as StringValue);

		if (maxMs !== undefined && data.duration > maxMs) {
			return { ok: false, message: `Duration must not exceed ${data.maximum}.` };
		}
	}

	return { ok: true };
}

/**
 * Check if a member has a higher role than another member.
 *
 * @param executor The executor
 * @param target The target
 * @returns boolean (Whether the executor has a higher role than the target)
 */

export function hierarchyCheck(executor: GuildMember, target: GuildMember): boolean {
	if (executor.guild.ownerId === executor.id) return true;
	if (target.guild.ownerId === target.id) return false;

	return executor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

/**
 * Converts a { Snowflake } to a formatted string with the format <@${Snowflake}}> (\`${Snowflake}\`).
 *
 * @param id The user id to format
 * @returns The formatted string
 */

export function userMentionWithId(id: Snowflake): `<@${Snowflake}> (\`${Snowflake}\`)` {
	return `<@${id}> (\`${id}\`)`;
}

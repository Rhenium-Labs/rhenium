import { GuildMember, Snowflake } from "discord.js";
import ms, { type StringValue } from "ms";

import type { SimpleResult } from "./Types.js";

/**
 * Returns the singular or plural form of a word based on the count.
 *
 * @param count The number to base the inflection on.
 * @param singular The singular form of the word.
 * @param plural The plural form of the word. Defaults to singular + "s".
 * @returns The appropriate singular or plural form based on the count.
 */
export function inflect(count: number, singular: string, plural = `${singular}s`): string {
	return count === 1 ? singular : plural;
}

/**
 * Truncates a string to a maximum length, appending an ellipsis and remaining character count.
 *
 * @param str The string to truncate.
 * @param maxLength The maximum length of the truncated string.
 *
 * @returns The truncated string with an ellipsis and remaining character count if truncated.
 */
export function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;

	const croppedStr = str.slice(0, maxLength - 23);
	return `${croppedStr}…(${str.length - croppedStr.length} more characters)`;
}

/**
 *  Crops a string to a maximum number of lines, appending an indicator if lines were removed.
 *
 * @param str The string to crop.
 * @param maxLines The maximum number of lines to retain.
 *
 * @returns The cropped string with an indicator if lines were removed.
 */
export function cropLines(str: string, maxLines: number): string {
	const lines = str.split("\n");
	if (lines.length <= maxLines) return str;

	const diff = lines.length - maxLines + 1;
	return [...lines.slice(0, maxLines - 1), `(${diff} more ${inflect(diff, "line")})`].join("\n");
}

/** Formats a user ID as a mention with the ID in parentheses. */
export function userMentionWithId(id: Snowflake): `<@${Snowflake}> (\`${Snowflake}\`)` {
	return `<@${id}> (\`${id}\`)`;
}

/** Delays execution for the specified number of milliseconds. */
export function sleep(duration: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, duration));
}

/** Parses a duration string into milliseconds. */
export function parseDurationString(str: string | null): number | null {
	if (!str) return null;

	const numericValue = Number(str);
	if (!isNaN(numericValue)) return numericValue * 1000;

	return ms(str as StringValue) ?? null;
}

/**
 * Validates that a duration falls within optional minimum and maximum bounds.
 *
 * @param data The duration data to validate.
 * @returns The result of the validation.
 */
export function validateDuration(data: { duration: number; minimum?: string; maximum?: string }): SimpleResult {
	const { duration, minimum, maximum } = data;

	const minMs = minimum ? ms(minimum as StringValue) : undefined;
	const maxMs = maximum ? ms(maximum as StringValue) : undefined;

	if (minMs && duration < minMs) {
		return { ok: false, message: `Duration must be at least ${minimum}.` };
	}

	if (maxMs && duration > maxMs) {
		return { ok: false, message: `Duration must not exceed ${maximum}.` };
	}

	return { ok: true };
}

/**
 * Checks if the executor has higher role hierarchy than the target.
 *
 * @param executor The member executing the action.
 * @param target The member being acted upon.
 *
 * @returns True if the executor has higher role hierarchy, false otherwise.
 */
export function hierarchyCheck(executor: GuildMember, target: GuildMember): boolean {
	if (executor.guild.ownerId === executor.id) return true;
	if (target.guild.ownerId === target.id) return false;

	return executor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

/**
 * Upload data to Hastebin and return the URL.
 *
 * @param data The data to upload.
 * @param ext The file extension for the uploaded data.
 *
 * @returns The Hastebin URL or null if the upload failed.
 */
export async function hastebin(data: unknown, ext = "js"): Promise<string | null> {
	const body = typeof data === "object" ? JSON.stringify(data, null, 2) : String(data);

	const response = await fetch("https://hst.sh/documents", { method: "POST", body });
	if (!response.ok) return null;

	const { key } = (await response.json()) as { key: string };
	return `https://hst.sh/${key}.${ext}`;
}

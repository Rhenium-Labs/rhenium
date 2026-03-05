import { json } from "@sveltejs/kit";
import { z } from "zod";
import { MESSAGE_REPORT_CONFIG_SCHEMA, type RawGuildConfig } from "@repo/config";
import { kysely } from "$utils/server/DB";
import { createBotClient } from "$utils/server/TRPC";
import {
	DISCORD_ID_REGEX,
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const MESSAGE_REPORTS_UPDATE_SCHEMA = z
	.object({
		enabled: z.boolean(),
		channelId: z.string().regex(DISCORD_ID_REGEX).nullable(),
		autoDisregardAfter: z.string().trim().max(32),
		deleteOnHandle: z.boolean(),
		placeholderReason: z.string().max(1024).nullable(),
		enforceMember: z.boolean(),
		enforceReason: z.boolean(),
		immuneRoles: z.array(z.string().regex(DISCORD_ID_REGEX)).max(250),
		notifyRoles: z
			.array(z.union([z.string().regex(DISCORD_ID_REGEX), z.literal("here")]))
			.max(250)
	})
	.strict();

function parseDuration(input: string): string {
	const trimmed = input.trim();
	if (trimmed === "" || trimmed === "0") return "0";

	const match = trimmed.match(/^(\d+)\s*(m|min|h|hr|hours?|d|days?|w|weeks?)$/i);
	if (!match) throw new Error("Invalid duration format");

	const num = parseInt(match[1]!, 10);
	if (!Number.isFinite(num) || num <= 0) return "0";

	const unit = match[2]!.toLowerCase();
	const multipliers: Record<string, bigint> = {
		m: 60_000n,
		min: 60_000n,
		h: 3_600_000n,
		hr: 3_600_000n,
		hour: 3_600_000n,
		hours: 3_600_000n,
		d: 86_400_000n,
		day: 86_400_000n,
		days: 86_400_000n,
		w: 604_800_000n,
		week: 604_800_000n,
		weeks: 604_800_000n
	};

	const multiplier = multipliers[unit];
	if (!multiplier) throw new Error("Invalid duration unit");

	const ms = BigInt(num) * multiplier;
	const max = 31_536_000_000n;
	if (ms > max) throw new Error("Duration too large");

	return ms.toString();
}

export const POST: RequestHandler = async ({ request, params, locals, url }) => {
	const requestSafetyError = ensureSafeJsonRequest(request, url.origin);
	if (requestSafetyError) {
		return json({ success: false, error: requestSafetyError }, { status: 403 });
	}

	const guildId = params.id;
	const access = await requireGuildConfigAccess({ locals }, guildId);
	if (!access.ok) return access.response;

	let payloadUnknown: unknown;
	try {
		payloadUnknown = await request.json();
	} catch {
		return json({ success: false, error: "Malformed JSON payload." }, { status: 400 });
	}

	const payloadResult = MESSAGE_REPORTS_UPDATE_SCHEMA.safeParse(payloadUnknown);
	if (!payloadResult.success) {
		return json(
			{
				success: false,
				error: `Invalid payload: ${payloadResult.error.issues.map(i => i.message).join(", ")}`
			},
			{ status: 400 }
		);
	}

	const payload = payloadResult.data;
	const guild = { config: access.currentConfig } as { config: RawGuildConfig };

	const trpc = createBotClient(guildId, access.session.userId);
	const [channels, roles] = await Promise.all([
		trpc.guild.channels.query({ guildId }),
		trpc.guild.roles.query({ guildId })
	]);

	if (payload.channelId) {
		const isValidChannel = channels.some(
			channel =>
				channel.id === payload.channelId && (channel.type === 0 || channel.type === 5)
		);
		if (!isValidChannel) {
			return json(
				{ success: false, error: "Selected channel is invalid." },
				{ status: 400 }
			);
		}
	}

	const validRoleIds = new Set(roles.filter(role => !role.managed).map(role => role.id));
	const immuneRoles = [...new Set(payload.immuneRoles)];
	const notifyRoles = [...new Set(payload.notifyRoles)];

	if (immuneRoles.some(roleId => !validRoleIds.has(roleId))) {
		return json(
			{ success: false, error: "Immune roles contain invalid role ids." },
			{ status: 400 }
		);
	}

	if (notifyRoles.some(roleId => roleId !== "here" && !validRoleIds.has(roleId))) {
		return json(
			{ success: false, error: "Notify roles contain invalid role ids." },
			{ status: 400 }
		);
	}

	let autoDisregardAfter: string;
	try {
		autoDisregardAfter = parseDuration(payload.autoDisregardAfter);
	} catch {
		return json(
			{
				success: false,
				error: "Invalid duration format. Use formats like: 30m, 12h, 3d, 1w"
			},
			{ status: 400 }
		);
	}

	const currentConfig = guild.config;
	let webhookUrl = currentConfig.message_reports.webhook_url;
	let webhookChannel = currentConfig.message_reports.webhook_channel;

	if (payload.channelId && payload.channelId !== webhookChannel) {
		try {
			const result = await trpc.guild.createWebhook.mutate({
				guildId,
				channelId: payload.channelId,
				existingUrl: webhookUrl ?? undefined
			});
			webhookUrl = result.url;
			webhookChannel = payload.channelId;
		} catch {
			return json(
				{
					success: false,
					error: "Failed to create a webhook in the selected channel. Make sure the bot has the Manage Webhooks permission."
				},
				{ status: 500 }
			);
		}
	} else if (!payload.channelId) {
		webhookUrl = null;
		webhookChannel = null;
	}

	const normalizedPlaceholder = payload.placeholderReason?.trim();
	const updatedReports = {
		enabled: payload.enabled,
		webhook_url: webhookUrl,
		webhook_channel: webhookChannel,
		auto_disregard_after: autoDisregardAfter,
		delete_submission_on_handle: payload.deleteOnHandle,
		immune_roles: immuneRoles,
		notify_roles: notifyRoles,
		blacklisted_users: currentConfig.message_reports.blacklisted_users,
		placeholder_reason:
			normalizedPlaceholder && normalizedPlaceholder.length > 0
				? normalizedPlaceholder
				: null,
		enforce_member_in_guild: payload.enforceMember,
		enforce_report_reason: payload.enforceReason
	};

	const parsed = MESSAGE_REPORT_CONFIG_SCHEMA.safeParse(updatedReports);
	if (!parsed.success) {
		return json(
			{
				success: false,
				error: `Invalid configuration: ${parsed.error.issues.map(i => i.message).join(", ")}`
			},
			{ status: 400 }
		);
	}

	await kysely
		.updateTable("Guild")
		.set({
			config: {
				...currentConfig,
				message_reports: parsed.data
			}
		})
		.where("id", "=", guildId)
		.execute();

	await invalidateBotConfigCache(guildId, access.session.userId);

	return json({ success: true });
};

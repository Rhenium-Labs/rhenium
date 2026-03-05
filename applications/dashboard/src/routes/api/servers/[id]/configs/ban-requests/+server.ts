import { json } from "@sveltejs/kit";
import { z } from "zod";
import { BAN_REQUEST_CONFIG_SCHEMA } from "@repo/config";
import { kysely } from "$utils/server/DB";
import { createBotClient } from "$utils/server/TRPC";
import {
	DISCORD_ID_REGEX,
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const BAN_REQUESTS_UPDATE_SCHEMA = z
	.object({
		enabled: z.boolean(),
		channelId: z.string().regex(DISCORD_ID_REGEX).nullable(),
		automaticallyTimeout: z.boolean(),
		enforceSubmissionReason: z.boolean(),
		enforceDenyReason: z.boolean(),
		immuneRoles: z.array(z.string().regex(DISCORD_ID_REGEX)).max(250),
		notifyRoles: z
			.array(z.union([z.string().regex(DISCORD_ID_REGEX), z.literal("here")]))
			.max(250),
		notifyTarget: z.boolean(),
		disableReasonField: z.boolean(),
		additionalInfo: z.string().max(2000).nullable(),
		deleteMessageSeconds: z
			.union([
				z.literal(60 * 60),
				z.literal(6 * 60 * 60),
				z.literal(12 * 60 * 60),
				z.literal(24 * 60 * 60),
				z.literal(3 * 24 * 60 * 60),
				z.literal(7 * 24 * 60 * 60)
			])
			.nullable()
	})
	.strict();

export const POST: RequestHandler = async ({ request, params, locals, url }) => {
	const safetyError = ensureSafeJsonRequest(request, url.origin);
	if (safetyError) return json({ success: false, error: safetyError }, { status: 403 });

	const access = await requireGuildConfigAccess({ locals }, params.id);
	if (!access.ok) return access.response;

	let payloadUnknown: unknown;
	try {
		payloadUnknown = await request.json();
	} catch {
		return json({ success: false, error: "Malformed JSON payload." }, { status: 400 });
	}

	const payloadResult = BAN_REQUESTS_UPDATE_SCHEMA.safeParse(payloadUnknown);
	if (!payloadResult.success) {
		return json(
			{ success: false, error: payloadResult.error.issues.map(i => i.message).join(", ") },
			{ status: 400 }
		);
	}

	const payload = payloadResult.data;
	const trpc = createBotClient(params.id, access.session.userId);
	const [channels, roles] = await Promise.all([
		trpc.guild.channels.query({ guildId: params.id }),
		trpc.guild.roles.query({ guildId: params.id })
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

	const current = access.currentConfig.ban_requests;
	let webhookUrl = current.webhook_url;
	let webhookChannel = current.webhook_channel;

	if (payload.channelId && payload.channelId !== webhookChannel) {
		try {
			const result = await trpc.guild.createWebhook.mutate({
				guildId: params.id,
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

	const parsed = BAN_REQUEST_CONFIG_SCHEMA.safeParse({
		enabled: payload.enabled,
		webhook_url: webhookUrl,
		webhook_channel: webhookChannel,
		automatically_timeout: payload.automaticallyTimeout,
		enforce_submission_reason: payload.enforceSubmissionReason,
		enforce_deny_reason: payload.enforceDenyReason,
		immune_roles: immuneRoles,
		notify_roles: notifyRoles,
		notify_target: payload.notifyTarget,
		disable_reason_field: payload.disableReasonField,
		additional_info: payload.additionalInfo?.trim() ? payload.additionalInfo.trim() : null,
		delete_message_seconds: payload.deleteMessageSeconds
	});
	if (!parsed.success) {
		return json(
			{ success: false, error: parsed.error.issues.map(i => i.message).join(", ") },
			{ status: 400 }
		);
	}

	await kysely
		.updateTable("Guild")
		.set({
			config: {
				...access.currentConfig,
				ban_requests: parsed.data
			}
		})
		.where("id", "=", params.id)
		.execute();

	await invalidateBotConfigCache(params.id, access.session.userId);

	return json({ success: true });
};

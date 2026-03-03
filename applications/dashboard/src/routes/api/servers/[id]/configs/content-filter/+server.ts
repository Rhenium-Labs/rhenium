import { json } from "@sveltejs/kit";
import { Detector } from "@repo/db";
import { z } from "zod";
import {
	CHANNEL_SCOPING_SCHEMA,
	ChannelScopingType,
	CONTENT_FILTER_CONFIG_SCHEMA,
	ContentFilterVerbosity,
	DetectorMode
} from "@repo/config";
import { kysely } from "$lib/server/kysely";
import { createBotClient } from "$lib/server/trpc";
import {
	DISCORD_ID_REGEX,
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const CONTENT_FILTER_UPDATE_SCHEMA = z
	.object({
		enabled: z.boolean(),
		channelId: z.string().regex(DISCORD_ID_REGEX).nullable().optional(),
		useNativeAutomod: z.boolean(),
		detectors: z.array(z.nativeEnum(Detector)).max(50),
		detectorMode: z.nativeEnum(DetectorMode),
		verbosity: z.nativeEnum(ContentFilterVerbosity),
		immuneRoles: z.array(z.string().regex(DISCORD_ID_REGEX)).max(250),
		notifyRoles: z
			.array(z.union([z.string().regex(DISCORD_ID_REGEX), z.literal("here")]))
			.max(250),
		channelScoping: z.array(
			z.object({
				channelId: z.string().regex(DISCORD_ID_REGEX),
				type: z.nativeEnum(ChannelScopingType)
			})
		),
		ocrFilterKeywords: z.array(z.string().trim().min(1).max(200)).max(300),
		ocrFilterRegex: z.array(z.string().trim().min(1).max(500)).max(300)
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

	const payloadResult = CONTENT_FILTER_UPDATE_SCHEMA.safeParse(payloadUnknown);
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

	const channelIds = new Set(channels.map(channel => channel.id));

	if (payload.channelId) {
		const isValidChannel = channels.some(
			channel =>
				channel.id === payload.channelId && (channel.type === 0 || channel.type === 5)
		);
		if (!isValidChannel) {
			return json(
				{ success: false, error: "Selected webhook channel is invalid." },
				{ status: 400 }
			);
		}
	}

	if (payload.channelScoping.some(scope => !channelIds.has(scope.channelId))) {
		return json(
			{ success: false, error: "Channel scoping contains invalid channels." },
			{ status: 400 }
		);
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

	const current = access.currentConfig.content_filter;
	let webhookUrl = current.webhook_url;

	if (payload.channelId) {
		try {
			const result = await trpc.guild.createWebhook.mutate({
				guildId: params.id,
				channelId: payload.channelId,
				existingUrl: webhookUrl ?? undefined
			});
			webhookUrl = result.url;
		} catch {
			return json(
				{
					success: false,
					error: "Failed to create a webhook in the selected channel. Make sure the bot has the Manage Webhooks permission."
				},
				{ status: 500 }
			);
		}
	}

	const parsedScoping = payload.channelScoping.map(scope => ({
		channel_id: scope.channelId,
		type: scope.type
	}));
	const scopingValidation = z.array(CHANNEL_SCOPING_SCHEMA).safeParse(parsedScoping);
	if (!scopingValidation.success) {
		return json(
			{
				success: false,
				error: scopingValidation.error.issues.map(i => i.message).join(", ")
			},
			{ status: 400 }
		);
	}

	const parsed = CONTENT_FILTER_CONFIG_SCHEMA.safeParse({
		enabled: payload.enabled,
		webhook_url: webhookUrl,
		use_native_automod: payload.useNativeAutomod,
		detectors: [...new Set(payload.detectors)],
		detector_mode: payload.detectorMode,
		verbosity: payload.verbosity,
		immune_roles: immuneRoles,
		notify_roles: notifyRoles,
		channel_scoping: parsedScoping,
		ocr_filter_keywords: payload.ocrFilterKeywords.map(item => item.trim()),
		ocr_filter_regex: payload.ocrFilterRegex.map(item => item.trim())
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
				content_filter: parsed.data
			}
		})
		.where("id", "=", params.id)
		.execute();

	await invalidateBotConfigCache(params.id, access.session.userId);

	return json({ success: true });
};

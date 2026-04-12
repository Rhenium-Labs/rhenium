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
import { kysely } from "$utils/server/DB";
import { createBotClient } from "$utils/server/TRPC";
import {
	DISCORD_ID_REGEX,
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const CONTENT_FILTER_TIMEOUT_DURATION_MIN_MS = 60 * 1000;
const CONTENT_FILTER_TIMEOUT_DURATION_MAX_MS = 28 * 24 * 60 * 60 * 1000;
const CONTENT_FILTER_DURATION_REGEX =
	/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?|w|week|weeks?)$/i;

const CONTENT_FILTER_DETECTOR_ACTION_UPDATE_SCHEMA = z
	.object({
		deleteMessage: z.boolean(),
		timeoutUser: z.boolean(),
		timeoutDuration: z
			.string()
			.trim()
			.max(32)
			.regex(CONTENT_FILTER_DURATION_REGEX)
	})
	.strict();

function parseTimeoutDurationMs(input: string): number {
	const trimmed = input.trim();
	const match = trimmed.match(CONTENT_FILTER_DURATION_REGEX);

	if (!match) {
		throw new Error("Invalid duration format. Use values like 10m, 2h, 7d, 4w.");
	}

	const amount = Number.parseInt(match[1]!, 10);
	if (!Number.isFinite(amount) || amount <= 0) {
		throw new Error("Duration amount must be a positive integer.");
	}

	const unit = match[2]!.toLowerCase();
	const multipliers: Record<string, bigint> = {
		m: 60_000n,
		min: 60_000n,
		mins: 60_000n,
		minute: 60_000n,
		minutes: 60_000n,
		h: 3_600_000n,
		hr: 3_600_000n,
		hrs: 3_600_000n,
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
	if (!multiplier) {
		throw new Error("Invalid duration unit. Use m, h, d, or w.");
	}

	const durationMs = BigInt(amount) * multiplier;

	if (durationMs < BigInt(CONTENT_FILTER_TIMEOUT_DURATION_MIN_MS)) {
		throw new Error("Timeout duration must be at least 1 minute.");
	}

	if (durationMs > BigInt(CONTENT_FILTER_TIMEOUT_DURATION_MAX_MS)) {
		throw new Error("Timeout duration cannot exceed 28 days.");
	}

	return Number(durationMs);
}

const CONTENT_FILTER_UPDATE_SCHEMA = z
	.object({
		enabled: z.boolean(),
		channelId: z.string().regex(DISCORD_ID_REGEX).nullable().optional(),
		useNativeAutomod: z.boolean(),
		useHeuristicScanner: z.boolean(),
		detectorActions: z
			.object({
				NSFW: CONTENT_FILTER_DETECTOR_ACTION_UPDATE_SCHEMA.extend({
					applyToTextNsfw: z.boolean()
				}),
				OCR: CONTENT_FILTER_DETECTOR_ACTION_UPDATE_SCHEMA,
				TEXT: CONTENT_FILTER_DETECTOR_ACTION_UPDATE_SCHEMA
			})
			.strict(),
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

	let detectorActionTimeouts: { NSFW: number; OCR: number; TEXT: number };
	try {
		detectorActionTimeouts = {
			NSFW: parseTimeoutDurationMs(payload.detectorActions.NSFW.timeoutDuration),
			OCR: parseTimeoutDurationMs(payload.detectorActions.OCR.timeoutDuration),
			TEXT: parseTimeoutDurationMs(payload.detectorActions.TEXT.timeoutDuration)
		};
	} catch (error) {
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : "Invalid timeout duration."
			},
			{ status: 400 }
		);
	}

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
		if (webhookUrl) {
			await trpc.guild.deleteWebhook
				.mutate({ guildId: params.id, webhookUrl })
				.catch(() => null);
		}

		webhookUrl = null;
		webhookChannel = null;
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
		webhook_channel: webhookChannel,
		use_native_automod: payload.useNativeAutomod,
		use_heuristic_scanner: payload.useHeuristicScanner,
		detector_actions: {
			NSFW: {
				delete_message: payload.detectorActions.NSFW.deleteMessage,
				timeout_user: payload.detectorActions.NSFW.timeoutUser,
				timeout_duration_ms: detectorActionTimeouts.NSFW,
				apply_to_text_nsfw: payload.detectorActions.NSFW.applyToTextNsfw
			},
			OCR: {
				delete_message: payload.detectorActions.OCR.deleteMessage,
				timeout_user: payload.detectorActions.OCR.timeoutUser,
				timeout_duration_ms: detectorActionTimeouts.OCR
			},
			TEXT: {
				delete_message: payload.detectorActions.TEXT.deleteMessage,
				timeout_user: payload.detectorActions.TEXT.timeoutUser,
				timeout_duration_ms: detectorActionTimeouts.TEXT
			}
		},
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

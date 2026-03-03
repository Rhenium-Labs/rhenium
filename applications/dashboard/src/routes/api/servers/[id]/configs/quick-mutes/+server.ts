import { json } from "@sveltejs/kit";
import { z } from "zod";
import { ChannelScopingType, QUICK_MUTE_CONFIG_SCHEMA } from "@repo/config";
import { kysely } from "$lib/server/Kysely";
import { createBotClient } from "$lib/server/trpc";
import {
	DISCORD_ID_REGEX,
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const QUICK_MUTES_UPDATE_SCHEMA = z
	.object({
		enabled: z.boolean(),
		purgeLimit: z.number().int().min(2).max(500),
		channelScoping: z
			.array(
				z.object({
					channelId: z.string().regex(DISCORD_ID_REGEX),
					type: z.nativeEnum(ChannelScopingType)
				})
			)
			.max(200)
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

	const payloadResult = QUICK_MUTES_UPDATE_SCHEMA.safeParse(payloadUnknown);
	if (!payloadResult.success) {
		return json(
			{ success: false, error: payloadResult.error.issues.map(i => i.message).join(", ") },
			{ status: 400 }
		);
	}

	const trpc = createBotClient(params.id, access.session.userId);
	const channels = await trpc.guild.channels.query({ guildId: params.id });
	const channelIds = new Set(channels.map(channel => channel.id));

	if (payloadResult.data.channelScoping.some(scope => !channelIds.has(scope.channelId))) {
		return json(
			{ success: false, error: "Channel scoping contains invalid channels." },
			{ status: 400 }
		);
	}

	const parsed = QUICK_MUTE_CONFIG_SCHEMA.safeParse({
		enabled: payloadResult.data.enabled,
		purge_limit: payloadResult.data.purgeLimit,
		channel_scoping: payloadResult.data.channelScoping.map(scope => ({
			channel_id: scope.channelId,
			type: scope.type
		}))
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
				quick_mutes: parsed.data
			}
		})
		.where("id", "=", params.id)
		.execute();

	await invalidateBotConfigCache(params.id, access.session.userId);

	return json({ success: true });
};

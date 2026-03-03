import { json } from "@sveltejs/kit";
import { z } from "zod";
import { LOGGING_WEBHOOK_SCHEMA, LoggingEvent } from "@repo/config";
import { kysely } from "$lib/server/Kysely";
import { createBotClient } from "$lib/server/trpc";
import {
	DISCORD_ID_REGEX,
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const LOGGING_UPDATE_SCHEMA = z
	.object({
		webhooks: z.array(
			z.object({
				id: z.string().regex(DISCORD_ID_REGEX).nullable(),
				channelId: z.string().regex(DISCORD_ID_REGEX),
				events: z.array(z.nativeEnum(LoggingEvent)).min(1).max(20)
			})
		)
	})
	.strict();

function parseWebhook(url: string): { id: string; token: string } | null {
	const match = url.match(/^https?:\/\/[^/]+\/api\/webhooks\/(\d{17,20})\/([^/?#]+)$/i);
	if (!match) return null;
	return { id: match[1]!, token: match[2]! };
}

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

	const payloadResult = LOGGING_UPDATE_SCHEMA.safeParse(payloadUnknown);
	if (!payloadResult.success) {
		return json(
			{ success: false, error: payloadResult.error.issues.map(i => i.message).join(", ") },
			{ status: 400 }
		);
	}

	const trpc = createBotClient(params.id, access.session.userId);
	const channels = await trpc.guild.channels.query({ guildId: params.id });
	const channelIds = new Set(
		channels
			.filter(channel => channel.type === 0 || channel.type === 5)
			.map(channel => channel.id)
	);

	if (payloadResult.data.webhooks.some(item => !channelIds.has(item.channelId))) {
		return json(
			{ success: false, error: "Webhook channels contain invalid channel ids." },
			{ status: 400 }
		);
	}

	const existingById = new Map(
		access.currentConfig.logging_webhooks.map(webhook => [webhook.id, webhook])
	);

	const nextWebhooks = [] as Array<{
		id: string;
		url: string;
		token: string;
		channel_id: string;
		events: LoggingEvent[];
	}>;

	for (const item of payloadResult.data.webhooks) {
		const existing = item.id ? existingById.get(item.id) : undefined;
		try {
			const result = await trpc.guild.createWebhook.mutate({
				guildId: params.id,
				channelId: item.channelId,
				existingUrl: existing?.url
			});

			const parsed = parseWebhook(result.url);
			if (!parsed) {
				return json(
					{
						success: false,
						error: "Received an invalid webhook url from bot service."
					},
					{ status: 500 }
				);
			}

			nextWebhooks.push({
				id: parsed.id,
				url: result.url,
				token: parsed.token,
				channel_id: item.channelId,
				events: [...new Set(item.events)]
			});
		} catch {
			return json(
				{
					success: false,
					error: "Failed to create a webhook in one of the selected channels. Make sure the bot has the Manage Webhooks permission."
				},
				{ status: 500 }
			);
		}
	}

	const validation = z.array(LOGGING_WEBHOOK_SCHEMA).safeParse(nextWebhooks);
	if (!validation.success) {
		return json(
			{ success: false, error: validation.error.issues.map(i => i.message).join(", ") },
			{ status: 400 }
		);
	}

	await kysely
		.updateTable("Guild")
		.set({
			config: {
				...access.currentConfig,
				logging_webhooks: validation.data
			}
		})
		.where("id", "=", params.id)
		.execute();

	await invalidateBotConfigCache(params.id, access.session.userId);

	return json({ success: true });
};

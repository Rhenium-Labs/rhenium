import { json } from "@sveltejs/kit";
import { z } from "zod";
import { HIGHLIGHT_CONFIG_SCHEMA } from "@repo/config";
import { kysely } from "$lib/server/kysely";
import {
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const HIGHLIGHTS_UPDATE_SCHEMA = z
	.object({
		enabled: z.boolean(),
		maxPatterns: z.number().int().min(1).max(30)
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

	const payloadResult = HIGHLIGHTS_UPDATE_SCHEMA.safeParse(payloadUnknown);
	if (!payloadResult.success) {
		return json(
			{ success: false, error: payloadResult.error.issues.map(i => i.message).join(", ") },
			{ status: 400 }
		);
	}

	const parsed = HIGHLIGHT_CONFIG_SCHEMA.safeParse({
		enabled: payloadResult.data.enabled,
		max_patterns: payloadResult.data.maxPatterns
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
				highlights: parsed.data
			}
		})
		.where("id", "=", params.id)
		.execute();

	await invalidateBotConfigCache(params.id, access.session.userId);

	return json({ success: true });
};

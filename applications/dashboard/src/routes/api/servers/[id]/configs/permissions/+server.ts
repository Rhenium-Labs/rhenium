import { json } from "@sveltejs/kit";
import { z } from "zod";
import { PERMISSION_SCOPE_SCHEMA, UserPermission } from "@repo/config";
import { kysely } from "$lib/server/kysely";
import { createBotClient } from "$lib/server/trpc";
import {
	DISCORD_ID_REGEX,
	ensureSafeJsonRequest,
	invalidateBotConfigCache,
	requireGuildConfigAccess
} from "$lib/server/configApi";
import type { RequestHandler } from "./$types";

const PERMISSIONS_UPDATE_SCHEMA = z
	.object({
		scopes: z.array(
			z.object({
				roleId: z.string().regex(DISCORD_ID_REGEX),
				allowedPermissions: z.array(z.nativeEnum(UserPermission)).max(20)
			})
		)
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

	const payloadResult = PERMISSIONS_UPDATE_SCHEMA.safeParse(payloadUnknown);
	if (!payloadResult.success) {
		return json(
			{ success: false, error: payloadResult.error.issues.map(i => i.message).join(", ") },
			{ status: 400 }
		);
	}

	const trpc = createBotClient(params.id, access.session.userId);
	const roles = await trpc.guild.roles.query({ guildId: params.id });
	const roleIds = new Set(roles.map(role => role.id));

	const dedupedScopes = new Map<string, UserPermission[]>();
	for (const scope of payloadResult.data.scopes) {
		if (!roleIds.has(scope.roleId)) {
			return json(
				{ success: false, error: "Permission scopes contain invalid role ids." },
				{ status: 400 }
			);
		}
		dedupedScopes.set(scope.roleId, [...new Set(scope.allowedPermissions)]);
	}

	const parsedScopes = [...dedupedScopes.entries()].map(([roleId, allowedPermissions]) => ({
		role_id: roleId,
		allowed_permissions: allowedPermissions
	}));

	const validation = z.array(PERMISSION_SCOPE_SCHEMA).safeParse(parsedScopes);
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
				permission_scopes: validation.data
			}
		})
		.where("id", "=", params.id)
		.execute();

	await invalidateBotConfigCache(params.id, access.session.userId);

	return json({ success: true });
};

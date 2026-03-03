import { json } from "@sveltejs/kit";

import { invalidateUserGuildsCache } from "$lib/server/Discord";
import type { RequestHandler } from "./$types";

/**
 * Invalidates the user's cached guild list.
 * Called when returning from a bot invite to ensure fresh data.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.session) {
		return json({ success: false, error: "Not authenticated" }, { status: 401 });
	}

	invalidateUserGuildsCache(locals.session.userId);
	return json({ success: true });
};

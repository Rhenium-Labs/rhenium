import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import KeyValueStore from "$utils/server/KVStore";

/**
 * Invalidates the user's cached guild list.
 * Called when returning from a bot invite to ensure fresh data.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.session)
		return json({ success: false, error: "Not authenticated" }, { status: 401 });

	KeyValueStore.delete(`user_guilds:${locals.session.userId}`);
	return json({ success: true });
};

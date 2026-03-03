import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { destroySession } from "$lib/server/Session";
import { invalidateUserGuildsCache } from "$lib/server/Discord";

/**
 * Logs the user out by destroying their session.
 */
export const GET: RequestHandler = async ({ cookies, locals }) => {
	if (locals.session?.userId) {
		invalidateUserGuildsCache(locals.session.userId);
	}
	await destroySession(cookies, locals.session?.userId);
	redirect(302, "/");
};

export const POST: RequestHandler = async ({ cookies, locals }) => {
	if (locals.session?.userId) {
		invalidateUserGuildsCache(locals.session.userId);
	}
	await destroySession(cookies, locals.session?.userId);
	redirect(302, "/");
};

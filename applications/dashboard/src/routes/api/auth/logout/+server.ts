import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import SessionManager from "$utils/server/Session";
import KeyValueStore from "$utils/server/KVStore";

/**
 * Logs the user out by destroying their session.
 */
export const GET: RequestHandler = async ({ cookies, locals }) => {
	if (locals.session?.userId) {
		KeyValueStore.delete(`user_guilds:${locals.session.userId}`);
	}
	await SessionManager.destroy(cookies, locals.session?.userId);
	redirect(302, "/");
};

export const POST: RequestHandler = async ({ cookies, locals }) => {
	if (locals.session?.userId) {
		KeyValueStore.delete(`user_guilds:${locals.session.userId}`);
	}
	await SessionManager.destroy(cookies, locals.session?.userId);
	redirect(302, "/");
};

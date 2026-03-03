import { redirect } from "@sveltejs/kit";
import { env } from "$lib/env";
import { getOAuthUrl } from "$lib/server/discord";
import { generateOAuthState, OAUTH_STATE_COOKIE } from "$lib/server/session";
import { hmacSign } from "$lib/server/crypto";
import type { RequestHandler } from "./$types";

/**
 * Initiates the Discord OAuth2 flow.
 * Generates a state parameter for CSRF protection and redirects to Discord.
 * The state is HMAC-signed to prevent tampering.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const nonce = generateOAuthState();
	const timestamp = Date.now().toString(36);
	const payload = `${nonce}.${timestamp}`;
	const signature = hmacSign(payload).slice(0, 16);
	const state = `${payload}.${signature}`;

	// Store state in a short-lived cookie for verification
	cookies.set(OAUTH_STATE_COOKIE, state, {
		path: "/",
		httpOnly: true,
		secure: env.PUBLIC_BASE_URL.startsWith("https"),
		sameSite: "lax", // Must be lax for OAuth redirect flow
		maxAge: 600 // 10 minutes
	});

	const authUrl = getOAuthUrl(state);
	redirect(302, authUrl);
};

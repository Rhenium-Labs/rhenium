import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { hmacSign } from "$lib/server/Crypto";
import { getOAuthUrl } from "$lib/server/Discord";
import { PUBLIC_BASE_URL } from "$env/static/public";
import { generateOAuthState, OAUTH_STATE_COOKIE } from "$lib/server/Session";

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
		secure: PUBLIC_BASE_URL.startsWith("https"),
		sameSite: "lax", // Must be lax for OAuth redirect flow
		maxAge: 600 // 10 minutes
	});

	const authUrl = getOAuthUrl(state);
	redirect(302, authUrl);
};

import { redirect, error, isRedirect, isHttpError } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { hmacSign, safeCompare } from "$lib/server/crypto";
import { exchangeCode, fetchUser } from "$lib/server/discord";
import { createSession, OAUTH_STATE_COOKIE } from "$lib/server/session";

/** Maximum age of a state parameter (10 minutes). */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Verifies the OAuth state parameter.
 * Checks HMAC signature and timestamp to prevent CSRF and replay attacks.
 */
function verifyState(state: string, storedState: string): boolean {
	// First, verify the stored state matches what we received
	if (!safeCompare(state, storedState)) {
		return false;
	}

	// Parse and verify the signature
	const parts = state.split(".");
	if (parts.length !== 3) {
		return false;
	}

	const [nonce, timestamp, providedSig] = parts;
	const payload = `${nonce}.${timestamp}`;
	const expectedSig = hmacSign(payload).slice(0, 16);

	// Timing-safe signature comparison
	if (!safeCompare(providedSig, expectedSig)) {
		return false;
	}

	// Verify timestamp is within acceptable range (prevents replay attacks)
	const stateTime = parseInt(timestamp, 36);
	if (isNaN(stateTime) || Date.now() - stateTime > STATE_MAX_AGE_MS) {
		return false;
	}

	return true;
}

/**
 * Handles the Discord OAuth2 callback.
 * Exchanges the authorization code for tokens and creates a session.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const storedState = cookies.get(OAUTH_STATE_COOKIE);

	// Clean up the state cookie immediately
	cookies.delete(OAUTH_STATE_COOKIE, { path: "/" });

	// Verify state to prevent CSRF and replay attacks
	if (!state || !storedState || !verifyState(state, storedState)) {
		error(400, "Invalid or expired OAuth state. Please try logging in again.");
	}

	if (!code) {
		const errorParam = url.searchParams.get("error");
		const errorDesc = url.searchParams.get("error_description");

		if (errorParam === "access_denied") {
			redirect(302, "/?error=access_denied");
		}

		error(400, errorDesc ?? "No authorization code provided");
	}

	try {
		// Exchange the code for tokens
		const tokens = await exchangeCode(code);

		// Fetch the user's profile
		const user = await fetchUser(tokens.access_token);

		// Create the session
		await createSession(cookies, {
			userId: user.id,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresIn: tokens.expires_in,
			username: user.username,
			globalName: user.global_name,
			avatar: user.avatar
		});
	} catch (err) {
		// Re-throw SvelteKit redirect/error exceptions
		if (isRedirect(err) || isHttpError(err)) {
			throw err;
		}

		console.error("OAuth callback error:", err);
		error(500, "Authentication failed. Please try again.");
	}

	// Redirect to the server selector (outside try/catch to avoid catching the redirect)
	redirect(302, "/servers");
};

import type { Cookies } from "@sveltejs/kit";

import { kysely } from "./kysely";
import { PUBLIC_BASE_URL } from "$env/static/public";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "$lib/env";
import { encrypt, decrypt, safeCompare, generateSecureToken } from "./crypto";

/**
 * Encryption purposes for key derivation.
 * Each purpose derives a unique key from the master secret.
 */
const ENCRYPTION_PURPOSE = {
	ACCESS_TOKEN: "db:access_token",
	REFRESH_TOKEN: "db:refresh_token",
	SESSION_COOKIE: "cookie:session"
} as const;

/**
 * Session data stored server-side.
 * Access token is NOT included - it's only available via getAccessToken().
 */
export interface Session {
	userId: string;
	sessionId: string;
	username: string | null;
	globalName: string | null;
	avatar: string | null;
	expiresAt: Date;
}

/**
 * Generates a cryptographically secure session ID.
 * This is an opaque identifier with no embedded information.
 */
function generateSessionId(): string {
	return generateSecureToken(32);
}

/**
 * Creates an encrypted session cookie value.
 * The cookie contains: sessionId + userId + timestamp, all encrypted.
 */
function createSessionCookie(sessionId: string, userId: string): string {
	const timestamp = Date.now();
	const payload = JSON.stringify({ sid: sessionId, uid: userId, ts: timestamp });
	return encrypt(payload, ENCRYPTION_PURPOSE.SESSION_COOKIE);
}

/**
 * Decrypts and validates a session cookie.
 * Returns the session ID and user ID if valid, null otherwise.
 */
function parseSessionCookie(cookieValue: string): { sessionId: string; userId: string } | null {
	const decrypted = decrypt(cookieValue, ENCRYPTION_PURPOSE.SESSION_COOKIE);
	if (!decrypted) return null;

	try {
		const data = JSON.parse(decrypted);

		// Validate structure
		if (
			typeof data.sid !== "string" ||
			typeof data.uid !== "string" ||
			typeof data.ts !== "number"
		) {
			return null;
		}

		// Check if cookie timestamp is within session duration
		if (Date.now() - data.ts > SESSION_DURATION_MS) {
			return null;
		}

		return { sessionId: data.sid, userId: data.uid };
	} catch {
		return null;
	}
}

/**
 * Encrypts a token for storage in the database.
 */
function encryptToken(token: string, purpose: string): string {
	return encrypt(token, purpose);
}

/**
 * Decrypts a token from the database.
 */
function decryptToken(encryptedToken: string, purpose: string): string | null {
	return decrypt(encryptedToken, purpose);
}

/**
 * Creates a new session in the database and sets the session cookie.
 */
export async function createSession(
	cookies: Cookies,
	data: {
		userId: string;
		accessToken: string;
		refreshToken: string;
		expiresIn: number;
		username: string;
		globalName: string | null;
		avatar: string | null;
	}
): Promise<void> {
	const sessionId = generateSessionId();
	const expiresAt = new Date(Date.now() + data.expiresIn * 1000);

	// Encrypt tokens before storing
	const encryptedAccessToken = encryptToken(data.accessToken, ENCRYPTION_PURPOSE.ACCESS_TOKEN);
	const encryptedRefreshToken = encryptToken(
		data.refreshToken,
		ENCRYPTION_PURPOSE.REFRESH_TOKEN
	);

	// Upsert the session in the database
	await kysely
		.insertInto("AuthSession")
		.values({
			user_id: data.userId,
			session_id: sessionId,
			access_token: encryptedAccessToken,
			refresh_token: encryptedRefreshToken,
			expires_at: expiresAt,
			updated_at: new Date(),
			username: data.username,
			global_name: data.globalName,
			avatar: data.avatar
		})
		.onConflict(oc =>
			oc.column("user_id").doUpdateSet({
				session_id: sessionId,
				access_token: encryptedAccessToken,
				refresh_token: encryptedRefreshToken,
				expires_at: expiresAt,
				updated_at: new Date(),
				username: data.username,
				global_name: data.globalName,
				avatar: data.avatar
			})
		)
		.execute();

	// Create encrypted session cookie
	const cookieValue = createSessionCookie(sessionId, data.userId);

	cookies.set(SESSION_COOKIE_NAME, cookieValue, {
		path: "/",
		httpOnly: true,
		secure: PUBLIC_BASE_URL.startsWith("https"),
		sameSite: "lax", // Lax is required for OAuth redirect chains to carry the cookie
		maxAge: Math.floor(SESSION_DURATION_MS / 1000)
	});
}

/**
 * Retrieves the current session from the database using the session cookie.
 * Returns a sanitized Session object that does NOT contain sensitive tokens.
 */
export async function getSession(cookies: Cookies): Promise<Session | null> {
	const cookieValue = cookies.get(SESSION_COOKIE_NAME);
	if (!cookieValue) return null;

	const parsed = parseSessionCookie(cookieValue);
	if (!parsed) {
		// Invalid/tampered cookie - clear it
		cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
		return null;
	}

	const session = await kysely
		.selectFrom("AuthSession")
		.select(["user_id", "session_id", "expires_at", "username", "global_name", "avatar"])
		.where("user_id", "=", parsed.userId)
		.executeTakeFirst();

	if (!session) return null;

	// Verify session ID matches (prevents session fixation attacks)
	if (!safeCompare(session.session_id, parsed.sessionId)) {
		cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
		return null;
	}

	// Check if session has expired
	if (new Date(session.expires_at) < new Date()) {
		await destroySession(cookies, parsed.userId);
		return null;
	}

	return {
		userId: session.user_id,
		sessionId: session.session_id,
		username: session.username,
		globalName: session.global_name,
		avatar: session.avatar,
		expiresAt: new Date(session.expires_at)
	};
}

/**
 * Gets the decrypted access token for a session.
 * This should ONLY be called server-side when making API requests.
 * NEVER expose the return value to the client.
 */
export async function getAccessToken(userId: string): Promise<string | null> {
	const session = await kysely
		.selectFrom("AuthSession")
		.select(["access_token", "expires_at"])
		.where("user_id", "=", userId)
		.executeTakeFirst();

	if (!session) return null;

	// Check expiry
	if (new Date(session.expires_at) < new Date()) {
		return null;
	}

	// Decrypt the access token
	return decryptToken(session.access_token, ENCRYPTION_PURPOSE.ACCESS_TOKEN);
}

/**
 * Gets the decrypted refresh token for a session.
 * Used for token refresh operations.
 */
export async function getRefreshToken(userId: string): Promise<string | null> {
	const session = await kysely
		.selectFrom("AuthSession")
		.select(["refresh_token"])
		.where("user_id", "=", userId)
		.executeTakeFirst();

	if (!session) return null;

	return decryptToken(session.refresh_token, ENCRYPTION_PURPOSE.REFRESH_TOKEN);
}

/**
 * Updates the tokens for an existing session (after refresh).
 */
export async function updateSessionTokens(
	userId: string,
	accessToken: string,
	refreshToken: string,
	expiresIn: number
): Promise<void> {
	const expiresAt = new Date(Date.now() + expiresIn * 1000);

	const encryptedAccessToken = encryptToken(accessToken, ENCRYPTION_PURPOSE.ACCESS_TOKEN);
	const encryptedRefreshToken = encryptToken(refreshToken, ENCRYPTION_PURPOSE.REFRESH_TOKEN);

	await kysely
		.updateTable("AuthSession")
		.set({
			access_token: encryptedAccessToken,
			refresh_token: encryptedRefreshToken,
			expires_at: expiresAt,
			updated_at: new Date()
		})
		.where("user_id", "=", userId)
		.execute();
}

/**
 * Destroys the current session.
 */
export async function destroySession(cookies: Cookies, userId?: string): Promise<void> {
	let uidToDelete = userId;

	if (!uidToDelete) {
		const cookieValue = cookies.get(SESSION_COOKIE_NAME);
		if (cookieValue) {
			const parsed = parseSessionCookie(cookieValue);
			if (parsed) {
				uidToDelete = parsed.userId;
			}
		}
	}

	if (uidToDelete) {
		await kysely.deleteFrom("AuthSession").where("user_id", "=", uidToDelete).execute();
	}

	cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * Generates a random state parameter for OAuth2 CSRF protection.
 */
export function generateOAuthState(): string {
	return generateSecureToken(16);
}

/**
 * Cookie name for OAuth state parameter.
 */
export const OAUTH_STATE_COOKIE = "rhenium_oauth_state";

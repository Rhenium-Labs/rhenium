import type { Cookies } from "@sveltejs/kit";
import type { AuthSession } from "../Types";

import { kysely } from "$utils/server/DB";
import { PUBLIC_BASE_URL } from "$env/static/public";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "$lib";
import { decrypt, encrypt, generateSecureToken, safeCompare } from "$lib/server/crypto";

export default class SessionManager {
	/**
	 * Get a session.
	 *
	 * @param cookies The Cookies object from SvelteKit to read the session cookie.
	 * @returns The session data if a valid session exists, or null if not authenticated.
	 */

	static async get(cookies: Cookies): Promise<AuthSession | null> {
		const cookieValue = cookies.get(SESSION_COOKIE_NAME);
		if (!cookieValue) return null;

		const parsedCookie = this._parseCookie(cookieValue);

		if (!parsedCookie) {
			// Invalid/tampered cookie - clear it.
			cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
			return null;
		}

		const session = await kysely
			.selectFrom("AuthSession")
			.select(["user_id", "session_id", "expires_at", "username", "global_name", "avatar"])
			.where("user_id", "=", parsedCookie.userId)
			.executeTakeFirst();

		if (!session) return null;

		// Verify session ID matches.
		if (!safeCompare(session.session_id, parsedCookie.sessionId)) {
			cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
			return null;
		}

		// Check if session is expired.
		if (new Date(session.expires_at) < new Date()) {
			await this.destroy(cookies, parsedCookie.userId);
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
	 * Destroys a session by deleting it from the database and clearing the cookie.
	 *
	 * @param cookies The Cookies object from SvelteKit to clear the session cookie.
	 * @param userId (Optional) The user ID of the session to destroy. If not provided, it will attempt to parse it from the cookie.
	 * @returns A promise that resolves when the session is destroyed.
	 */

	static async destroy(cookies: Cookies, userId?: string): Promise<void> {
		let uidToDelete = userId;

		if (!uidToDelete) {
			const cookieValue = cookies.get(SESSION_COOKIE_NAME);

			if (cookieValue) {
				const parsed = this._parseCookie(cookieValue);
				if (parsed) uidToDelete = parsed.userId;
			}
		}

		if (uidToDelete)
			// prettier-ignore
			await kysely
				.deleteFrom("AuthSession")
				.where("user_id", "=", uidToDelete)
				.execute();

		return cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
	}

	/**
	 * Creates a new session for the user, storing it in the database and setting a secure cookie.
	 *
	 * @param cookies The Cookies object from SvelteKit to set the session cookie.
	 * @param data The data for the session.
	 *   - userId: The ID of the user.
	 *   - accessToken: The access token to encrypt and store.
	 *   - refreshToken: The refresh token to encrypt and store.
	 *   - expiresIn: The duration in seconds until the session expires.
	 *   - username: The username of the user.
	 *   - globalName: The global name of the user (nullable).
	 *   - avatar: The avatar of the user (nullable).
	 */

	static async create(
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
		const sessionId = this._generateId();
		const expiresAt = new Date(Date.now() + data.expiresIn * 1000);

		// Encrypt tokens before storing
		const encryptedAccessToken = encrypt(data.accessToken, ENCRYPTION_PURPOSE.ACCESS_TOKEN);

		const encryptedRefreshToken = encrypt(
			data.refreshToken,
			ENCRYPTION_PURPOSE.REFRESH_TOKEN
		);

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

		const cookieValue = this._createCookie(sessionId, data.userId);

		return cookies.set(SESSION_COOKIE_NAME, cookieValue, {
			path: "/",
			httpOnly: true,
			secure: PUBLIC_BASE_URL.startsWith("https"),
			sameSite: "lax", // Lax is required for OAuth redirect chains to carry the cookie.
			maxAge: Math.floor(SESSION_DURATION_MS / 1000)
		});
	}

	/**
	 * Retrieves and decrypts the access token for a given user ID.
	 *
	 * @param userId The ID of the user whose access token is to be retrieved.
	 * @returns The decrypted access token if a valid session exists, or null if not found/expired.
	 */

	static async getAccessToken(userId: string): Promise<string | null> {
		const session = await kysely
			.selectFrom("AuthSession")
			.select(["access_token", "expires_at"])
			.where("user_id", "=", userId)
			.executeTakeFirst();

		if (!session) return null;
		if (new Date(session.expires_at) < new Date()) return null;

		return decrypt(session.access_token, ENCRYPTION_PURPOSE.ACCESS_TOKEN);
	}

	/**
	 * Retrieves and decrypts the refresh token for a given user ID.
	 *
	 * @param userId The ID of the user whose refresh token is to be retrieved.
	 * @returns The decrypted refresh token if a valid session exists, or null if not found.
	 */

	static async getRefreshToken(userId: string): Promise<string | null> {
		const session = await kysely
			.selectFrom("AuthSession")
			.select(["refresh_token", "expires_at"])
			.where("user_id", "=", userId)
			.executeTakeFirst();

		if (!session) return null;

		return decrypt(session.refresh_token, ENCRYPTION_PURPOSE.REFRESH_TOKEN);
	}

	/**
	 * Generates a cryptographically secure session ID.
	 * @returns A new session ID string.
	 */

	private static _generateId(): string {
		return generateSecureToken(32);
	}

	/**
	 * Generates an encrypted session cookie.
	 *
	 * @param sessionId The session ID to include in the cookie.
	 * @param userId The user ID to include in the cookie.
	 * @return An encrypted string to be used as a session cookie value.
	 */

	private static _createCookie(sessionId: string, userId: string): string {
		const timestamp = Date.now();
		const payload = JSON.stringify({ sid: sessionId, uid: userId, ts: timestamp });
		return encrypt(payload, ENCRYPTION_PURPOSE.SESSION_COOKIE);
	}

	/**
	 * Parses and validates a session cookie value.
	 *
	 * @param cookieValue The encrypted cookie value to parse.
	 * @returns An object containing sessionId and userId if valid, or null if invalid/expired.
	 */

	private static _parseCookie(
		cookieValue: string
	): { sessionId: string; userId: string } | null {
		const decrypted = decrypt(cookieValue, ENCRYPTION_PURPOSE.SESSION_COOKIE);
		if (!decrypted) return null;

		try {
			const data = JSON.parse(decrypted);

			if (
				typeof data.sid !== "string" ||
				typeof data.uid !== "string" ||
				typeof data.ts !== "number"
			) {
				return null;
			}

			// Check if cookie timestamp is within session duration.
			if (Date.now() - data.ts > SESSION_DURATION_MS) {
				return null;
			}

			return { sessionId: data.sid, userId: data.uid };
		} catch {
			return null;
		}
	}
}

/**
 * Cookie name for OAuth state parameter.
 */
export const OAUTH_STATE_COOKIE = "rhenium_oauth_state";

/**
 * Encryption purposes for key derivation.
 * Each purpose derives a unique key from the master secret.
 */
const ENCRYPTION_PURPOSE = {
	ACCESS_TOKEN: "db:access_token",
	REFRESH_TOKEN: "db:refresh_token",
	SESSION_COOKIE: "cookie:session"
} as const;

/**
 * Represents an authenticated user session.
 * Contains user info and session expiration details, but no actual tokens.
 */
export type AuthSession = {
	userId: string;
	sessionId: string;
	username: string | null;
	globalName: string | null;
	avatar: string | null;
	expiresAt: Date;
};

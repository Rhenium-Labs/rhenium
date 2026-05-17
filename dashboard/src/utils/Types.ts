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

/** Simplified channel representation returned by the bot REST API. */
export type ChannelInfo = {
	id: string;
	name: string;
	type: number;
	parentId: string | null;
	position: number;
};

/** Simplified role representation returned by the bot REST API. */
export type RoleInfo = {
	id: string;
	name: string;
	color: number;
	position: number;
	managed: boolean;
};

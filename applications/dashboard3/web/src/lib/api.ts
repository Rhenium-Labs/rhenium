import { env } from "@/env";

export const apiUrl = (path: string) => `${env.VITE_API_URL}${path}`;

export const authUrls = {
	discord: () => apiUrl("/api/v1/auth/discord"),
	discordCallback: (code: string) =>
		apiUrl(`/api/v1/auth/discord/callback?code=${encodeURIComponent(code)}`),
} as const;

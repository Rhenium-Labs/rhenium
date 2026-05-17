import type { PageServerLoad } from "./$types";

// All shared data (session, guild) is loaded by +layout.server.ts
export const load: PageServerLoad = async () => {
	return {};
};

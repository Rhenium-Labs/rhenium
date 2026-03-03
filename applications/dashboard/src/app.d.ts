declare global {
	namespace App {
		interface Error {
			message: string;
			description?: string;
		}

		interface Locals {
			requestId: string;
			session: {
				userId: string;
				sessionId: string;
				username: string | null;
				globalName: string | null;
				avatar: string | null;
				expiresAt: Date;
			} | null;
		}

		interface PageData {
			session?: App.Locals["session"];
		}
	}
}

export {};

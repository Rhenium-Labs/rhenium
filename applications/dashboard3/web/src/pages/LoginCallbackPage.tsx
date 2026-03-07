import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuthStore } from "@/stores/auth";
import { authUrls } from "@/lib/api";
import { LoadingScreen } from "@/components/LoadingScreen";

export function LoginCallbackPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const { login } = useAuthStore();

	useEffect(() => {
		const code = searchParams.get("code");
		if (!code) {
			setError("Missing authorization code");
			return;
		}

		fetch(authUrls.discordCallback(code))
			.then(async (res) => {
				if (!res.ok) throw new Error("Token exchange failed");
				const data = (await res.json()) as {
					token: string;
					user: {
						id: string;
						username: string;
						avatar: string | null;
					};
				};
				login(data.token, data.user);
				navigate("/home", { replace: true });
			})
			.catch((err) => setError(err instanceof Error ? err.message : "Login failed"));
	}, [searchParams, login, navigate]);

	if (error) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-discord-main">
				<p className="text-destructive">{error}</p>
			</div>
		);
	}

	return <LoadingScreen />;
}

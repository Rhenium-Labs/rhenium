import { ServerCrash } from "lucide-react";

export function ServerErrorFallback() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-discord-main">
			<div className="flex flex-col items-center gap-6 text-center">
				<ServerCrash className="size-16 text-discord-muted" />
				<div className="space-y-2">
					<h1 className="text-xl font-bold text-discord-text">
						Server is temporarily unavailable
					</h1>
					<p className="text-sm text-discord-muted">
						We're having trouble connecting. Please try again.
					</p>
				</div>
				<button
					type="button"
					onClick={() => {
						window.location.reload();
					}}
					className="rounded-md bg-discord-blurple px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-discord-blurple/80 active:scale-95"
				>
					Refresh Page
				</button>
			</div>
		</div>
	);
}

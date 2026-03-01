/** Shown in the main area when at /home. Server selection lives in the sidebar only. */
export function HomeDashboardContent() {
	return (
		<div className="flex h-full flex-col items-center justify-center p-8">
			<p className="text-center text-discord-muted">
				Select a server from the sidebar to get started.
			</p>
		</div>
	);
}

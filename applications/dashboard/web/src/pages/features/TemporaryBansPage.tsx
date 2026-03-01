import { TemporaryBansService } from "@/service/temporary-bans";
import { useGuild } from "@/contexts/GuildContext";
import { DataTable } from "@/components/form";
import { LoadingScreen } from "@/components/LoadingScreen";

export function TemporaryBansPage() {
	const { guildId } = useGuild();
	const { data: bans, isLoading, error } = TemporaryBansService.useList(guildId);

	if (isLoading) return <LoadingScreen className="relative bg-transparent" />;
	if (error) {
		return <div className="p-6 text-sm text-discord-muted">{error}</div>;
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto p-6">
			<h2 className="mb-1 text-lg font-bold text-discord-text">Temporary Bans</h2>
			<p className="mb-4 text-sm text-discord-muted">
				View active temporary bans and their expiry times.
			</p>

			<DataTable
				columns={[
					{
						key: "target_id",
						header: "User ID",
						render: (r) => (
							<span className="font-mono text-xs">{r.target_id}</span>
						),
					},
					{
						key: "expires_at",
						header: "Expires",
						render: (r) => {
							const date = new Date(r.expires_at);
							const now = new Date();
							const remaining = date.getTime() - now.getTime();
							const isExpired = remaining <= 0;

							return (
								<div className="space-y-0.5">
									<div className="text-xs">
										{date.toLocaleDateString()} {date.toLocaleTimeString()}
									</div>
									<div className={`text-xs ${isExpired ? "text-destructive" : "text-discord-success"}`}>
										{isExpired ? "Expired" : formatRemaining(remaining)}
									</div>
								</div>
							);
						},
					},
				]}
				data={bans ?? []}
				keyExtractor={(r) => `${r.target_id}-${r.expires_at}`}
				emptyMessage="No active temporary bans"
			/>
		</div>
	);
}

function formatRemaining(ms: number): string {
	const hours = Math.floor(ms / (1000 * 60 * 60));
	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;

	if (days > 0) return `${days}d ${remainingHours}h remaining`;
	if (hours > 0) return `${hours}h remaining`;
	const minutes = Math.floor(ms / (1000 * 60));
	return `${minutes}m remaining`;
}

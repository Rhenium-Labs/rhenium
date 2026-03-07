import { useNavigate } from "react-router";
import { useGuild } from "@/contexts/GuildContext";
import { useGuildStore } from "@/stores/guild";
import { FeatureCard } from "@/components/ui/FeatureCard";
import { SettingsLoading } from "@/components/SettingsLoading";

const FEATURES = [
	{ key: "message_reports" as const, name: "Message Reports", description: "Allow members to report messages to staff for review." },
	{ key: "ban_requests" as const, name: "Ban Requests", description: "Enable staff to submit and review ban requests." },
	{ key: "content_filter" as const, name: "Content Filter", description: "Automatically detect and filter inappropriate content." },
	{ key: "highlights" as const, name: "Highlights", description: "Get notified when keywords you care about are mentioned." },
	{ key: "quick_mutes" as const, name: "Quick Mutes", description: "Quickly mute disruptive members with one click." },
	{ key: "quick_purges" as const, name: "Quick Purges", description: "Bulk delete messages from channels efficiently." },
] as const;

export function GuildDashboardPage() {
	const navigate = useNavigate();
	const { guildId, guild, isLoading, error } = useGuild();
	const { selectedGuild } = useGuildStore();

	if (isLoading) {
		return <SettingsLoading />;
	}

	if (error) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-8">
				<p className="text-sm text-discord-muted">Failed to load guild data</p>
				<p className="text-xs text-destructive">{error}</p>
			</div>
		);
	}

	const guildName = selectedGuild?.name ?? guildId;

	return (
		<div className="flex h-full flex-col overflow-y-auto p-8">
			<div className="mb-6">
				<h1 className="text-xl font-bold text-discord-text">{guildName}</h1>
				<p className="mt-1 text-sm text-discord-muted">
					Manage features and settings for this server.
				</p>
			</div>

			<div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
				{FEATURES.map((feature) => (
					<FeatureCard
						key={feature.key}
						name={feature.name}
						description={feature.description}
						enabled={guild?.features[feature.key]?.enabled ?? false}
						onClick={() =>
							navigate(
								`/guilds/${guildId}/settings/${feature.key.replace(/_/g, "-")}`,
							)
						}
					/>
				))}
			</div>
		</div>
	);
}

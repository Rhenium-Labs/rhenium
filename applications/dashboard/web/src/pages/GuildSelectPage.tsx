import { useNavigate } from "react-router";
import { GuildService } from "@/service/guild";
import { useGuildStore } from "@/stores/guild";
import { SettingsLoading } from "@/components/SettingsLoading";

export function GuildSelectPage() {
	const navigate = useNavigate();
	const { setGuild } = useGuildStore();
	const { data: guilds, isLoading, error } = GuildService.useUserGuilds();

	if (isLoading) {
		return <SettingsLoading />;
	}

	if (error) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-discord-muted">
				<p className="text-sm">Failed to load servers</p>
				<p className="text-xs text-destructive">{error}</p>
			</div>
		);
	}

	const whitelisted = guilds?.filter((g) => g.whitelisted) ?? [];
	const available = guilds?.filter((g) => !g.whitelisted) ?? [];

	function handleSelect(guild: { id: string; name: string; icon: string | null }) {
		setGuild({ id: guild.id, name: guild.name, icon: guild.icon });
		navigate(`/guilds/${guild.id}`);
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto p-8">
			<h1 className="mb-6 text-xl font-bold text-discord-text">Select a Server</h1>

			{whitelisted.length > 0 && (
				<section className="mb-8">
					<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-discord-muted">
						Configured Servers
					</h2>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
						{whitelisted.map((guild) => (
							<GuildCard
								key={guild.id}
								guild={guild}
								onSelect={() => handleSelect(guild)}
							/>
						))}
					</div>
				</section>
			)}

			{available.length > 0 && (
				<section>
					<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-discord-muted">
						Available Servers
					</h2>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
						{available.map((guild) => (
							<GuildCard
								key={guild.id}
								guild={guild}
								disabled
								onSelect={() => handleSelect(guild)}
							/>
						))}
					</div>
				</section>
			)}

			{!guilds?.length && (
				<div className="flex flex-1 items-center justify-center text-discord-muted">
					<p className="text-sm">No servers with manage permissions found.</p>
				</div>
			)}
		</div>
	);
}

interface GuildCardProps {
	guild: { id: string; name: string; icon: string | null; whitelisted: boolean };
	disabled?: boolean;
	onSelect: () => void;
}

function GuildCard({ guild, disabled, onSelect }: GuildCardProps) {
	return (
		<button
			type="button"
			onClick={onSelect}
			disabled={disabled}
			className="flex items-center gap-3 rounded-lg border border-discord-divider bg-discord-panel p-3 text-left transition-colors hover:bg-discord-hover disabled:cursor-not-allowed disabled:opacity-50"
		>
			<div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-discord-blurple">
				{guild.icon ? (
					<img src={guild.icon} alt="" className="size-full object-cover" />
				) : (
					<span className="text-sm font-bold text-white">
						{guild.name.charAt(0).toUpperCase()}
					</span>
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium text-discord-text">
					{guild.name}
				</div>
				{!guild.whitelisted && (
					<div className="text-xs text-discord-muted">Not configured</div>
				)}
			</div>
		</button>
	);
}

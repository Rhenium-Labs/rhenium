import { type ReactNode } from "react";
import { useNavigate, useLocation, useParams } from "react-router";
import {
	MessageSquareWarning,
	ShieldBan,
	Filter,
	Sparkles,
	VolumeX,
	Trash2,
	Webhook,
	Clock,
	ArrowLeft,
	type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGuildStore } from "@/stores/guild";

interface FeatureNavItem {
	id: string;
	label: string;
	icon: LucideIcon;
	path: string;
}

const FEATURE_NAV: FeatureNavItem[] = [
	{ id: "message-reports", label: "Message Reports", icon: MessageSquareWarning, path: "message-reports" },
	{ id: "ban-requests", label: "Ban Requests", icon: ShieldBan, path: "ban-requests" },
	{ id: "content-filter", label: "Content Filter", icon: Filter, path: "content-filter" },
	{ id: "highlights", label: "Highlights", icon: Sparkles, path: "highlights" },
	{ id: "quick-mutes", label: "Quick Mutes", icon: VolumeX, path: "quick-mutes" },
	{ id: "quick-purges", label: "Quick Purges", icon: Trash2, path: "quick-purges" },
	{ id: "logging", label: "Logging", icon: Webhook, path: "logging" },
	{ id: "temporary-bans", label: "Temporary Bans", icon: Clock, path: "temporary-bans" },
];

interface GuildSettingsLayoutProps {
	children: ReactNode;
}

export function GuildSettingsLayout({ children }: GuildSettingsLayoutProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const { guildId } = useParams<{ guildId: string }>();
	const { selectedGuild } = useGuildStore();

	const currentPath = location.pathname.split("/settings/")[1]?.split("/")[0] ?? "";

	return (
		<div className="flex h-full">
			<nav className="flex w-56 shrink-0 flex-col border-r border-discord-divider bg-discord-panel">
				<div className="border-b border-discord-divider px-3 py-3">
					<button
						type="button"
						onClick={() => navigate(`/guilds/${guildId}`)}
						className="flex items-center gap-2 text-sm text-discord-muted transition-colors hover:text-discord-text"
					>
						<ArrowLeft className="size-4" />
						<span className="truncate font-medium">
							{selectedGuild?.name ?? "Back"}
						</span>
					</button>
				</div>
				<div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
					<div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-discord-muted">
						Features
					</div>
					{FEATURE_NAV.map((item) => {
						const Icon = item.icon;
						const isActive = currentPath === item.path;
						return (
							<button
								key={item.id}
								type="button"
								onClick={() =>
									navigate(`/guilds/${guildId}/settings/${item.path}`)
								}
								className={cn(
									"flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
									"text-discord-muted hover:bg-discord-hover/70 hover:text-discord-text",
									isActive && "bg-discord-hover font-semibold text-white",
								)}
							>
								<Icon className="size-4 shrink-0" />
								<span className="truncate">{item.label}</span>
							</button>
						);
					})}
				</div>
			</nav>
			<div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
				{children}
			</div>
		</div>
	);
}

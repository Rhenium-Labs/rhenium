import { useNavigate, useParams, useLocation } from "react-router";
import { useGuildStore } from "@/stores/guild";
import {
	MessageSquareWarning,
	ShieldBan,
	Filter,
	Sparkles,
	VolumeX,
	Trash2,
	Webhook,
	Clock,
	LayoutDashboard,
	Settings,
	type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
	label: string;
	icon: LucideIcon;
	path: string;
}

const GUILD_NAV: NavItem[] = [
	{ label: "Overview", icon: LayoutDashboard, path: "" },
	{ label: "Settings", icon: Settings, path: "settings/message-reports" },
];

const FEATURE_NAV: NavItem[] = [
	{ label: "Message Reports", icon: MessageSquareWarning, path: "settings/message-reports" },
	{ label: "Ban Requests", icon: ShieldBan, path: "settings/ban-requests" },
	{ label: "Content Filter", icon: Filter, path: "settings/content-filter" },
	{ label: "Highlights", icon: Sparkles, path: "settings/highlights" },
	{ label: "Quick Mutes", icon: VolumeX, path: "settings/quick-mutes" },
	{ label: "Quick Purges", icon: Trash2, path: "settings/quick-purges" },
	{ label: "Logging", icon: Webhook, path: "settings/logging" },
	{ label: "Temporary Bans", icon: Clock, path: "settings/temporary-bans" },
];

export function ChannelPanel() {
	const { guildId } = useParams<{ guildId: string }>();
	const { selectedGuild } = useGuildStore();
	const navigate = useNavigate();
	const location = useLocation();

	if (!guildId) {
		return (
			<div className="flex w-sidebar-panel shrink-0 flex-col bg-discord-panel">
				<div className="border-b border-discord-divider px-4 py-3">
					<span className="text-sm font-semibold text-discord-text">Rhenium</span>
				</div>
				<div className="flex-1 overflow-y-auto scrollbar-thin" />
			</div>
		);
	}

	const basePath = `/guilds/${guildId}`;
	const relativePath = location.pathname.replace(basePath, "").replace(/^\//, "");

	return (
		<div className="flex w-sidebar-panel shrink-0 flex-col bg-discord-panel">
			<div className="border-b border-discord-divider px-4 py-3">
				<span className="truncate text-sm font-semibold text-discord-text">
					{selectedGuild?.name ?? "Server"}
				</span>
			</div>
			<div className="flex flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin p-2">
				{GUILD_NAV.map((item) => {
					const Icon = item.icon;
					const isActive = item.path === ""
						? relativePath === ""
						: relativePath.startsWith("settings");
					return (
						<button
							key={item.label}
							type="button"
							onClick={() => navigate(`${basePath}/${item.path}`.replace(/\/$/, ""))}
							className={cn(
								"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
								"text-discord-muted hover:bg-discord-hover/70 hover:text-discord-text",
								isActive && "bg-discord-hover font-medium text-white",
							)}
						>
							<Icon className="size-4 shrink-0" />
							<span className="truncate">{item.label}</span>
						</button>
					);
				})}

				{relativePath.startsWith("settings") && (
					<>
						<div className="mt-3 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-discord-muted">
							Features
						</div>
						{FEATURE_NAV.map((item) => {
							const Icon = item.icon;
							const isActive = relativePath === item.path;
							return (
								<button
									key={item.label}
									type="button"
									onClick={() => navigate(`${basePath}/${item.path}`)}
									className={cn(
										"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
										"text-discord-muted hover:bg-discord-hover/70 hover:text-discord-text",
										isActive && "bg-discord-hover font-medium text-white",
									)}
								>
									<Icon className="size-3.5 shrink-0" />
									<span className="truncate">{item.label}</span>
								</button>
							);
						})}
					</>
				)}
			</div>
		</div>
	);
}

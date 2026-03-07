import { useNavigate, useParams, useLocation } from "react-router";
import { useGuildStore } from "@/stores/guild";
import { useMobileSidebar } from "@/contexts/MobileSidebarContext";
import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";

// Config pages are shown as \"channels\" like #message-reports, sorted alphabetically.
const FEATURE_NAV: { key: string; path: string }[] = [
	{ key: "ban-requests", path: "settings/ban-requests" },
	{ key: "content-filter", path: "settings/content-filter" },
	{ key: "highlights", path: "settings/highlights" },
	{ key: "logging", path: "settings/logging" },
	{ key: "message-reports", path: "settings/message-reports" },
	{ key: "quick-mutes", path: "settings/quick-mutes" },
	{ key: "quick-purges", path: "settings/quick-purges" },
	{ key: "temporary-bans", path: "settings/temporary-bans" },
];

export function ChannelPanel() {
	const { guildId } = useParams<{ guildId: string }>();
	const { selectedGuild } = useGuildStore();
	const navigate = useNavigate();
	const location = useLocation();
	const { close: closeMobileSidebar } = useMobileSidebar();

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
				{relativePath.startsWith("settings") && (
					<>
						<div className="mt-3 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-discord-muted">
							Configuration
						</div>
						{[...FEATURE_NAV]
							.sort((a, b) => a.key.localeCompare(b.key))
							.map((item) => {
								const isActive = relativePath === item.path;
								return (
									<button
										key={item.key}
										type="button"
										onClick={() => {
											closeMobileSidebar();
											navigate(`${basePath}/${item.path}`);
										}}
										className={cn(
											"flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
											"text-discord-muted hover:bg-discord-hover/70 hover:text-discord-text",
											isActive && "bg-discord-hover font-medium text-white",
										)}
									>
										<Hash className="size-3.5 shrink-0 text-discord-muted" />
										<span className="truncate">{item.key}</span>
									</button>
								);
							})}
					</>
				)}
			</div>
		</div>
	);
}

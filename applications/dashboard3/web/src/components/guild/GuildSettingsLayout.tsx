import { type ReactNode } from "react";
import { useLocation, useParams } from "react-router";
import { Menu } from "lucide-react";
import { useMobileSidebar } from "@/contexts/MobileSidebarContext";
import { cn } from "@/lib/utils";

interface GuildSettingsLayoutProps {
	children: ReactNode;
}

/**
 * Wrapper for guild settings content: sticky header with channel/setting name,
 * scrollable body below. On mobile, header includes hamburger to open server/channel list.
 */
export function GuildSettingsLayout({ children }: GuildSettingsLayoutProps) {
	const { guildId } = useParams<{ guildId: string }>();
	const location = useLocation();
	const { open: openMobileSidebar } = useMobileSidebar();
	const basePath = guildId ? `/guilds/${guildId}/settings` : "";
	const relativePath = location.pathname.replace(basePath, "").replace(/^\//, "") || "settings";

	return (
		<div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
			<header className="flex shrink-0 items-center gap-3 border-b border-discord-divider bg-discord-panel px-4 py-3">
				<button
					type="button"
					onClick={openMobileSidebar}
					aria-label="Open server and channel list"
					className={cn(
						"flex shrink-0 -ml-1 rounded p-1.5 text-discord-muted transition-colors",
						"hover:bg-discord-hover hover:text-discord-text md:hidden"
					)}
				>
					<Menu className="size-5" />
				</button>
				<h2 className="min-w-0 truncate text-base font-semibold text-discord-text">
					#{relativePath}
				</h2>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{children}
			</div>
		</div>
	);
}

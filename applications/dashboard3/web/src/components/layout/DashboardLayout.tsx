import { type ReactNode } from "react";
import { useLocation } from "react-router";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { UserSettingsProvider } from "@/contexts/UserSettingsContext";
import { MobileSidebarProvider } from "@/contexts/MobileSidebarContext";
import { useMobileSidebar } from "@/contexts/MobileSidebarContext";
import { UserSettingsPage } from "@/pages/UserSettingsPage";
import { GuildService } from "@/service/guild";
import { LoadingScreen } from "@/components/LoadingScreen";

interface DashboardLayoutProps {
	children: ReactNode;
}

/** Mobile-only header with hamburger to open sidebar (used on /home and guild dashboard). */
function MobileSidebarHeader() {
	const { open } = useMobileSidebar();
	const location = useLocation();
	const isHome = location.pathname === "/home";
	const isGuildDashboard = /^\/guilds\/[^/]+$/.test(location.pathname);
	const show = isHome || isGuildDashboard;

	if (!show) return null;

	return (
		<header className="flex shrink-0 items-center gap-3 border-b border-discord-divider bg-discord-panel px-4 py-3 md:hidden">
			<button
				type="button"
				onClick={open}
				aria-label="Open server and channel list"
				className="flex shrink-0 -ml-1 rounded p-1.5 text-discord-muted transition-colors hover:bg-discord-hover hover:text-discord-text"
			>
				<Menu className="size-5" />
			</button>
			<span className="text-base font-semibold text-discord-text">
				{isHome ? "Servers" : "Server"}
			</span>
		</header>
	);
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
	const { isLoading, error } = GuildService.useUserGuilds();

	// When landing directly on a dashboard URL, always block the shell until
	// we've resolved the user's manageable guilds (and thus their access).
	if (isLoading) {
		return <LoadingScreen />;
	}

	if (error) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-discord-main">
				<p className="text-sm text-discord-muted">Failed to load your servers.</p>
			</div>
		);
	}

	return (
		<UserSettingsProvider>
			<MobileSidebarProvider>
				<div className="fixed inset-0 flex h-screen w-screen overflow-hidden bg-discord-main">
					<Sidebar />
					<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
						<MobileSidebarHeader />
						<div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
					</main>
				</div>
				<UserSettingsPage />
			</MobileSidebarProvider>
		</UserSettingsProvider>
	);
}

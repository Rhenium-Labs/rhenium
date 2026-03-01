import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { UserSettingsProvider } from "@/contexts/UserSettingsContext";
import { UserSettingsPage } from "@/pages/UserSettingsPage";

interface DashboardLayoutProps {
	children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
	return (
		<UserSettingsProvider>
			<div className="fixed inset-0 flex h-screen w-screen overflow-hidden bg-discord-main">
				<Sidebar />
				<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
				</main>
			</div>
			<UserSettingsPage />
		</UserSettingsProvider>
	);
}

import { ServerStrip } from "./ServerStrip";
import { ChannelPanel } from "./ChannelPanel";
import { UserSection } from "../UserSection";
import { useMobileSidebar } from "@/contexts/MobileSidebarContext";
import { cn } from "@/lib/utils";

/** Discord-style left sidebar: server list + channel area with user section spanning full width at bottom. */
export function Sidebar() {
	const { isOpen, close } = useMobileSidebar();

	return (
		<>
			{/* Mobile backdrop */}
			<button
				type="button"
				aria-label="Close menu"
				onClick={close}
				className={cn(
					"fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden",
					isOpen ? "visible opacity-100" : "invisible pointer-events-none opacity-0"
				)}
			/>
			<aside
				className={cn(
					"flex h-full shrink-0 flex-col bg-discord-sidebar transition-transform duration-200 md:relative md:translate-x-0",
					"fixed inset-y-0 left-0 z-50 w-[min(85vw,19.5rem)] md:static md:w-auto!",
					isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
				)}
			>
				<div className="flex min-h-0 flex-1">
					<ServerStrip />
					<ChannelPanel />
				</div>
				<UserSection />
			</aside>
		</>
	);
}

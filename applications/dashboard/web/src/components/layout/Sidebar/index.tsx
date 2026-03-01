import { ServerStrip } from "./ServerStrip";
import { ChannelPanel } from "./ChannelPanel";
import { UserSection } from "../UserSection";

/** Discord-style left sidebar: server list + channel area with user section spanning full width at bottom. */
export function Sidebar() {
	return (
		<aside className="flex h-full shrink-0 flex-col bg-discord-sidebar">
			<div className="flex min-h-0 flex-1">
				<ServerStrip />
				<ChannelPanel />
			</div>
			<UserSection />
		</aside>
	);
}

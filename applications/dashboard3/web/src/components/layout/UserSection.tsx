import { useAuthStore } from "@/stores/auth";
import { Settings } from "lucide-react";
import { discordAvatarUrl } from "@/constants/discord";
import { useUserSettings } from "@/contexts/UserSettingsContext";

export function UserSection() {
	const { user } = useAuthStore();
	const { open } = useUserSettings();

	return (
		<div className="flex shrink-0 items-center gap-2 border-t border-discord-sidebar bg-discord-sidebar px-2 py-1">
			<button
				type="button"
				className="flex flex-1 items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-discord-hover"
			>
				<div className="relative size-8 shrink-0 overflow-hidden rounded-full bg-discord-blurple">
					{user?.avatar ? (
						<img
							src={discordAvatarUrl(user.id, user.avatar) ?? undefined}
							alt=""
							className="size-full object-cover"
						/>
					) : (
						<span className="flex size-full items-center justify-center text-sm font-medium text-white">
							{user?.username?.charAt(0).toUpperCase() ?? "?"}
						</span>
					)}
				</div>
				<div className="min-w-0 flex-1 overflow-hidden text-left">
					<div className="truncate text-sm font-medium text-discord-text">
						{user?.username ?? "User"}
					</div>
					<div className="truncate text-xs text-discord-muted">
						{user ? `@${user.username}` : ""}
					</div>
				</div>
			</button>
			<button
				type="button"
				onClick={open}
				className="shrink-0 rounded p-1 text-discord-muted transition-colors hover:text-discord-text"
				aria-label="Open settings"
			>
				<Settings className="size-5" />
			</button>
		</div>
	);
}

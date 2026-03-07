import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { BaseModal, BaseModalHeader } from "@/components/ui/BaseModal";
import { BaseSectionButton } from "@/components/settings/BaseSectionButton";
import { UserAvatar } from "@/components/UserAvatar";
import { useMobileSidebar } from "@/contexts/MobileSidebarContext";
import { cn } from "@/lib/utils";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import { useAuthStore } from "@/stores/auth";
import { AppearanceSection } from "./settings/Apperance";

type SettingId = "appearance";

const APP_SETTINGS: { id: SettingId; label: string; icon: string | null }[] = [
	{ id: "appearance", label: "Appearance", icon: "Palette" },
];

export function UserSettingsPage() {
	const { isOpen, close } = useUserSettings();
	const { user, logout } = useAuthStore();
	const navigate = useNavigate();
	const [activeSetting, setActiveSetting] = useState<SettingId>("appearance");
	const [mobilePane, setMobilePane] = useState<"list" | "content">("list");
	const { open: openMobileSidebar } = useMobileSidebar();

	useEffect(() => {
		if (isOpen) setMobilePane("list");
	}, [isOpen]);

	const closeToSidebar = () => {
		close();
		// On mobile, user expects to land back on server/channel list.
		if (window.matchMedia("(max-width: 767px)").matches) {
			openMobileSidebar();
		}
	};

	const handleLogout = () => {
		logout();
		closeToSidebar();
		navigate("/");
	};

	return (
		<BaseModal
			isOpen={isOpen}
			onClose={close}
			className="h-full w-full md:h-[min(80vh,520px)] md:w-[min(90vw,720px)]"
		>
			<div className="flex h-full min-h-0 flex-1 flex-col md:flex-row">
				<aside
					className={cn(
						"flex w-full flex-1 flex-col border-b border-discord-divider bg-discord-sidebar md:w-3/10 md:flex-none md:border-b-0 md:border-r",
						mobilePane === "content" && "hidden md:flex",
					)}
				>
					<div className="md:hidden">
						<BaseModalHeader onClose={closeToSidebar}>
							<span className="text-base font-semibold text-discord-text">
								Settings
							</span>
						</BaseModalHeader>
					</div>
					<div className="flex items-center gap-3 border-b border-discord-divider px-4 py-3">
						<UserAvatar user={user} size="md" />
						<div className="min-w-0 flex-1 overflow-hidden">
							<div className="truncate text-sm font-semibold text-discord-text">
								{user?.username ?? "User"}
							</div>
							<div className="truncate text-xs text-discord-muted">
								{user ? `@${user.username}` : ""}
							</div>
						</div>
					</div>

					<nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
						<div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-discord-muted">
							App Settings
						</div>
						{APP_SETTINGS.map((s) => (
							<BaseSectionButton
								key={s.id}
								icon={s.icon}
								name={s.label}
								isActive={activeSetting === s.id}
								onClick={() => {
									setActiveSetting(s.id);
									setMobilePane("content");
								}}
							/>
						))}
					</nav>
					<div className="shrink-0 border-t border-discord-divider p-2">
						<BaseSectionButton
							icon="LogOut"
							name="Log out"
							onClick={handleLogout}
							className="text-red-400 hover:bg-red-500/10 hover:text-red-400"
						/>
					</div>
				</aside>

				<div
					className={cn(
						"flex w-full min-h-0 flex-1 flex-col md:w-7/10",
						mobilePane === "list" && "hidden md:flex",
					)}
				>
					<BaseModalHeader onClose={closeToSidebar}>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setMobilePane("list")}
								aria-label="Back"
								className="mr-1 rounded p-1 text-discord-muted transition-colors hover:bg-discord-hover hover:text-discord-text md:hidden"
							>
								<ChevronLeft className="size-4" />
							</button>
							<span className="truncate text-base font-semibold text-discord-text">
								{APP_SETTINGS.find((s) => s.id === activeSetting)?.label ??
									"Settings"}
							</span>
						</div>
					</BaseModalHeader>
					<main className="flex-1 overflow-y-auto p-4">
						{activeSetting === "appearance" && <AppearanceSection />}
					</main>
				</div>
			</div>
		</BaseModal>
	);
}


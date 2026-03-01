import { useState } from "react";
import { BaseModal, BaseModalHeader } from "@/components/ui/BaseModal";
import { BaseSectionButton } from "@/components/settings/BaseSectionButton";
import { SubSection } from "@/components/settings/SubSection";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import { useAuthStore } from "@/stores/auth";
import { discordAvatarUrl } from "@/constants/discord";

type SettingId = "appearance";

const APP_SETTINGS: { id: SettingId; label: string; icon: string | null }[] = [
	{ id: "appearance", label: "Appearance", icon: "Palette" },
];

export function UserSettingsPage() {
	const { isOpen, close } = useUserSettings();
	const { user } = useAuthStore();
	const [activeSetting, setActiveSetting] = useState<SettingId>("appearance");

	return (
		<BaseModal
			isOpen={isOpen}
			onClose={close}
			className="h-[min(80vh,520px)] w-[min(90vw,720px)]"
		>
			<div className="flex min-h-0 flex-1">
				<aside className="flex w-3/10 shrink-0 flex-col border-r border-discord-divider bg-discord-sidebar">
					<div className="flex items-center gap-3 border-b border-discord-divider px-4 py-3">
						<div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-discord-blurple">
							{user?.avatar ? (
								<img
									src={discordAvatarUrl(user.id, user.avatar) ?? undefined}
									alt=""
									className="size-full object-cover"
								/>
							) : (
								<span className="flex size-full items-center justify-center text-base font-medium text-white">
									{user?.username?.charAt(0).toUpperCase() ?? "?"}
								</span>
							)}
						</div>
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
								onClick={() => setActiveSetting(s.id)}
							/>
						))}
					</nav>
				</aside>

				<div className="flex w-7/10 min-h-0 flex-1 flex-col">
					<BaseModalHeader onClose={close}>
						<span className="text-base font-semibold text-discord-text">
							{APP_SETTINGS.find((s) => s.id === activeSetting)?.label ??
								"Settings"}
						</span>
					</BaseModalHeader>
					<main className="flex-1 overflow-y-auto p-4">
						{activeSetting === "appearance" && <AppearanceSection />}
					</main>
				</div>
			</div>
		</BaseModal>
	);
}

const THEME_SWATCHES: { id: "light" | "dark"; color: string; label: string }[] = [
	{ id: "light", color: "#ffffff", label: "Light" },
	{ id: "dark", color: "#313338", label: "Dark" },
];

function AppearanceSection() {
	const { theme, setTheme } = useTheme();

	return (
		<SubSection id="theme" title="Theme">
			<div className="flex gap-3">
				{THEME_SWATCHES.map(({ id, color, label }) => (
					<ThemeOption
						key={id}
						color={color}
						label={label}
						isActive={theme === id}
						onClick={() => setTheme(id)}
					/>
				))}
			</div>
		</SubSection>
	);
}

interface ThemeOptionProps {
	color: string;
	label: string;
	isActive: boolean;
	onClick: () => void;
}

function ThemeOption({ color, label, isActive, onClick }: ThemeOptionProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`flex flex-col items-center gap-2 transition-colors outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${
				isActive ? "" : "hover:opacity-90 active:opacity-80"
			}`}
		>
			<div
				className="size-14 shrink-0 rounded-lg border-2 border-white"
				style={{ backgroundColor: color }}
			/>
			<span className="text-xs font-medium text-discord-muted">{label}</span>
		</button>
	);
}

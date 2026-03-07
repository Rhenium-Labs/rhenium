import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SettingProps {
	children: ReactNode;
	className?: string;
}

export function Setting({ children, className }: SettingProps) {
	return (
		<div
			className={cn(
				"space-y-2 rounded-lg border border-discord-divider bg-discord-panel p-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

interface SettingTitleProps {
	children: ReactNode;
	className?: string;
}

export function SettingTitle({ children, className }: SettingTitleProps) {
	return (
		<h3
			className={cn(
				"text-sm font-semibold text-discord-text",
				className,
			)}
		>
			{children}
		</h3>
	);
}

interface SettingSubtitleProps {
	children: ReactNode;
	className?: string;
}

export function SettingSubtitle({ children, className }: SettingSubtitleProps) {
	return (
		<p className={cn("text-xs text-discord-muted", className)}>
			{children}
		</p>
	);
}

import { type LucideIcon, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, LucideIcon> = {
	Palette,
};

interface BaseSectionButtonProps {
	icon: string | null;
	name: string;
	isActive?: boolean;
	onClick?: () => void;
	className?: string;
}

export function BaseSectionButton({
	icon,
	name,
	isActive = false,
	onClick,
	className,
}: BaseSectionButtonProps) {
	const Icon = icon ? ICON_MAP[icon] : null;

	return (
		<Button
			type="button"
			variant="ghost"
			onClick={onClick}
			className={cn(
				"h-auto w-full justify-start gap-3 rounded-md border-0 px-3 py-2 text-left text-sm transition-colors",
				"outline-none focus-visible:border-0 focus-visible:ring-0 focus-visible:ring-offset-0",
				"bg-transparent text-discord-muted",
				"hover:bg-discord-hover/70 hover:text-discord-text",
				"active:bg-discord-hover active:text-discord-text",
				"focus-visible:bg-discord-hover/70 focus-visible:text-discord-text",
				isActive && "bg-discord-hover font-semibold text-white",
				className
			)}
		>
			{Icon && <Icon className="size-4 shrink-0" />}
			<span className={cn("truncate", isActive && "font-semibold")}>{name}</span>
		</Button>
	);
}

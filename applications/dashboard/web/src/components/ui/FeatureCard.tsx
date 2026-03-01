import { cn } from "@/lib/utils";

interface FeatureCardProps {
	name: string;
	description: string;
	enabled: boolean;
	onClick: () => void;
}

export function FeatureCard({ name, description, enabled, onClick }: FeatureCardProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex flex-col gap-2 rounded-lg border border-discord-divider bg-discord-panel p-4 text-left transition-colors hover:bg-discord-hover"
		>
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-semibold text-discord-text">{name}</h3>
				<span
					className={cn(
						"rounded-full px-2 py-0.5 text-xs font-medium",
						enabled
							? "bg-discord-success/20 text-discord-success"
							: "bg-discord-muted/20 text-discord-muted",
					)}
				>
					{enabled ? "Enabled" : "Disabled"}
				</span>
			</div>
			<p className="text-xs text-discord-muted">{description}</p>
		</button>
	);
}

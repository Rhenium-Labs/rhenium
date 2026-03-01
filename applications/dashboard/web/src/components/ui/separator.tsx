import { cn } from "@/lib/utils"

interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
	orientation?: "horizontal" | "vertical";
}

function Separator({ className, orientation = "horizontal", ...props }: SeparatorProps) {
	return (
		<div
			role="separator"
			className={cn(
				"shrink-0 bg-discord-divider",
				orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
				className
			)}
			{...props}
		/>
	);
}

export { Separator };

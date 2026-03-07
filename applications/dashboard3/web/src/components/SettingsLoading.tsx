import { cn } from "@/lib/utils";
import { APP_LOGO, APP_NAME } from "@/constants/brand";

interface SettingsLoadingProps {
	className?: string;
}

/**
 * Centered loading indicator confined to the settings/content area.
 * Unlike LoadingScreen, this does NOT cover the entire viewport or sidebar.
 */
export function SettingsLoading({ className }: SettingsLoadingProps) {
	return (
		<div
			className={cn(
				"flex h-full w-full flex-col items-center justify-center bg-transparent",
				className,
			)}
		>
			<div className="flex flex-col items-center gap-4">
				<div className="relative">
					<img
						src={APP_LOGO}
						alt={APP_NAME}
						className="h-16 w-16 object-contain animate-pulse"
						onError={(e) => {
							const target = e.currentTarget;
							if (target.src.endsWith("Rhenium.png")) {
								target.src = "/Rhenium.svg";
							}
						}}
					/>
				</div>
				<div className="flex gap-1.5">
					<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground [animation-delay:0ms]" />
					<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground [animation-delay:150ms]" />
					<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground [animation-delay:300ms]" />
				</div>
			</div>
		</div>
	);
}


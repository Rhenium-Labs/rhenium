import { APP_LOGO, APP_NAME } from "@/constants/brand";
import { cn } from "@/lib/utils";

interface LoadingScreenProps {
	className?: string;
}

export function LoadingScreen({ className }: LoadingScreenProps) {
	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex flex-col items-center justify-center bg-discord-main",
				className
			)}
		>
			<div className="flex flex-col items-center gap-6">
				<div className="relative">
					<img
						src={APP_LOGO}
						alt={APP_NAME}
						className="h-24 w-24 object-contain animate-pulse"
						onError={(e) => {
							const target = e.currentTarget;
							if (target.src.endsWith("Rhenium.png")) {
								target.src = "/Rhenium.svg";
							}
						}}
					/>
					<div className="absolute -inset-4 -z-10 animate-ping rounded-full bg-primary/20 opacity-30" />
				</div>
				<div className="flex gap-1.5">
					<span className="h-2 w-2 animate-bounce rounded-full bg-foreground [animation-delay:0ms]" />
					<span className="h-2 w-2 animate-bounce rounded-full bg-foreground [animation-delay:150ms]" />
					<span className="h-2 w-2 animate-bounce rounded-full bg-foreground [animation-delay:300ms]" />
				</div>
			</div>
		</div>
	);
}

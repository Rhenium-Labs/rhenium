import RheniumLogo from "@/assets/Rhenium.png";
import { cn } from "@/lib/utils";

type BaseIconVariant = "app" | "server";

interface BaseIconProps {
	variant: BaseIconVariant;
	onClick?: () => void;
	icon?: string | null;
	alt?: string;
	isActive?: boolean;
	/** Muted style (e.g. for non-configured servers) */
	muted?: boolean;
}

export function BaseIcon({ variant, onClick, icon, alt, isActive, muted }: BaseIconProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-discord-blurple text-white transition-all hover:rounded-2xl",
				isActive && "rounded-2xl ring-2 ring-white/30",
				muted && "opacity-60 grayscale hover:opacity-80 hover:grayscale-0",
			)}
		>
			{variant === "app" ? (
				<img
					src={RheniumLogo}
					alt="Rhenium"
					className="block max-h-8 max-w-8 object-contain"
				/>
			) : icon ? (
				<img src={icon} alt={alt ?? "Server"} className="size-full object-cover" />
			) : (
				<span className="text-lg font-bold text-white">
					{(alt ?? "?").charAt(0).toUpperCase()}
				</span>
			)}
		</button>
	);
}

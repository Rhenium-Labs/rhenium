import { discordAvatarUrl } from "@/constants/discord";
import type { AuthUser } from "@/stores/auth";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
	user: Pick<AuthUser, "id" | "avatar" | "username"> | null;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const SIZE_CLASS = {
	sm: "size-8",
	md: "size-10",
	lg: "size-12",
} as const;

const TEXT_CLASS = {
	sm: "text-sm",
	md: "text-base",
	lg: "text-lg",
} as const;

export function UserAvatar({ user, size = "md", className }: UserAvatarProps) {
	const sizeClass = SIZE_CLASS[size];

	return (
		<div
			className={cn(
				"relative shrink-0 overflow-hidden rounded-full bg-discord-blurple",
				sizeClass,
				className
			)}
		>
			{user?.avatar ? (
				<img
					src={discordAvatarUrl(user.id, user.avatar) ?? undefined}
					alt=""
					className="size-full object-cover"
				/>
			) : (
				<span className={cn("flex size-full items-center justify-center font-medium text-white", TEXT_CLASS[size])}>
					{user?.username?.charAt(0).toUpperCase() ?? "?"}
				</span>
			)}
		</div>
	);
}

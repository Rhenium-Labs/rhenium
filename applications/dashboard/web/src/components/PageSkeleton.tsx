export function PageSkeleton() {
	return (
		<div className="flex h-full flex-col overflow-y-auto p-6 animate-in fade-in duration-150">
			{/* Header */}
			<div className="space-y-2 mb-6">
				<div className="h-6 w-48 rounded bg-discord-divider animate-pulse" />
				<div className="h-4 w-72 rounded bg-discord-divider/60 animate-pulse" />
			</div>

			{/* Toggle setting */}
			<SkeletonSetting>
				<div className="flex items-center justify-between">
					<div className="space-y-1.5">
						<div className="h-4 w-36 rounded bg-discord-divider animate-pulse" />
						<div className="h-3 w-56 rounded bg-discord-divider/50 animate-pulse" />
					</div>
					<div className="h-6 w-11 rounded-full bg-discord-divider animate-pulse" />
				</div>
			</SkeletonSetting>

			{/* Channel/role select setting */}
			<SkeletonSetting>
				<div className="h-4 w-28 rounded bg-discord-divider animate-pulse mb-2" />
				<div className="h-3 w-64 rounded bg-discord-divider/50 animate-pulse mb-3" />
				<div className="h-9 w-full rounded-md bg-discord-divider/40 animate-pulse" />
			</SkeletonSetting>

			{/* Number input setting */}
			<SkeletonSetting>
				<div className="h-4 w-40 rounded bg-discord-divider animate-pulse mb-2" />
				<div className="h-3 w-52 rounded bg-discord-divider/50 animate-pulse mb-3" />
				<div className="h-9 w-32 rounded-md bg-discord-divider/40 animate-pulse" />
			</SkeletonSetting>

			{/* Another toggle */}
			<SkeletonSetting>
				<div className="flex items-center justify-between">
					<div className="space-y-1.5">
						<div className="h-4 w-44 rounded bg-discord-divider animate-pulse" />
						<div className="h-3 w-60 rounded bg-discord-divider/50 animate-pulse" />
					</div>
					<div className="h-6 w-11 rounded-full bg-discord-divider animate-pulse" />
				</div>
			</SkeletonSetting>
		</div>
	);
}

function SkeletonSetting({ children }: { children: React.ReactNode }) {
	return (
		<div className="space-y-2 rounded-lg border border-discord-divider bg-discord-panel p-4 mb-3">
			{children}
		</div>
	);
}

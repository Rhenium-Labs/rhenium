import { cn } from "@/lib/utils";

interface ToggleSwitchProps {
	label: string;
	description?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}

export function ToggleSwitch({
	label,
	description,
	checked,
	onChange,
	disabled,
}: ToggleSwitchProps) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-lg border border-discord-divider bg-discord-panel p-4">
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium text-discord-text">{label}</div>
				{description && (
					<div className="mt-0.5 text-xs text-discord-muted">{description}</div>
				)}
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={cn(
					"relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
					checked ? "bg-discord-success" : "bg-discord-divider",
					disabled && "cursor-not-allowed opacity-50",
				)}
			>
				<span
					className={cn(
						"pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform",
						checked ? "translate-x-5.5" : "translate-x-0.5",
					)}
				/>
			</button>
		</div>
	);
}

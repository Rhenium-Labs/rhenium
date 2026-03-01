import { cn } from "@/lib/utils";

interface NumberInputProps {
	label: string;
	description?: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	disabled?: boolean;
}

export function NumberInput({
	label,
	description,
	value,
	onChange,
	min,
	max,
	disabled,
}: NumberInputProps) {
	return (
		<div className="space-y-1.5">
			<label className="text-xs font-medium uppercase tracking-wider text-discord-muted">
				{label}
			</label>
			{description && (
				<p className="text-xs text-discord-muted">{description}</p>
			)}
			<input
				type="number"
				value={value}
				onChange={(e) => {
					const n = Number(e.target.value);
					if (!Number.isNaN(n)) onChange(n);
				}}
				min={min}
				max={max}
				disabled={disabled}
				className={cn(
					"w-full rounded-md border border-discord-divider bg-discord-sidebar px-3 py-2 text-sm text-discord-text",
					"focus:outline-none focus:ring-1 focus:ring-discord-blurple",
					"disabled:cursor-not-allowed disabled:opacity-50",
				)}
			/>
		</div>
	);
}

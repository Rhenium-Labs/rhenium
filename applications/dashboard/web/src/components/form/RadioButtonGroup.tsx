import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface RadioOption {
	value: string;
	label: string;
	description?: string;
}

interface RadioButtonGroupProps {
	value: string;
	onChange: (value: string) => void;
	options: RadioOption[] | readonly string[];
	disabled?: boolean;
	orientation?: "vertical" | "horizontal";
}

function normalizeOptions(
	options: RadioOption[] | readonly string[],
): RadioOption[] {
	return options.map((opt) =>
		typeof opt === "string" ? { value: opt, label: opt } : opt,
	);
}

export function RadioButtonGroup({
	value,
	onChange,
	options,
	disabled,
	orientation = "vertical",
}: RadioButtonGroupProps) {
	const items = normalizeOptions(options);

	return (
		<RadioGroup
			value={value}
			onValueChange={onChange}
			disabled={disabled}
			className={
				orientation === "horizontal"
					? "flex flex-row flex-wrap gap-3"
					: "grid gap-2"
			}
		>
			{items.map((item) => (
				<label
					key={item.value}
					className="flex cursor-pointer items-start gap-2.5 rounded-md border border-discord-divider bg-discord-panel p-3 transition-colors hover:bg-discord-hover/50 has-data-[state=checked]:border-discord-blurple has-data-[state=checked]:bg-discord-blurple/10"
				>
					<RadioGroupItem
						variant="discord"
						value={item.value}
						className="mt-0.5"
					/>
					<div className="min-w-0 flex-1">
						<span className="text-sm font-medium text-discord-text">
							{item.label}
						</span>
						{item.description && (
							<p className="mt-0.5 text-xs text-discord-muted">
								{item.description}
							</p>
						)}
					</div>
				</label>
			))}
		</RadioGroup>
	);
}

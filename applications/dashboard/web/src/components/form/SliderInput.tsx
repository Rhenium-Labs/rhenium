import { Slider } from "@/components/ui/slider";
import { useCallback } from "react";

interface SliderInputProps {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	showValue?: boolean;
	formatValue?: (value: number) => string;
}

export function SliderInput({
	value,
	onChange,
	min = 0,
	max = 100,
	step = 1,
	disabled,
	showValue = true,
	formatValue,
}: SliderInputProps) {
	const handleChange = useCallback(
		(vals: number[]) => {
			onChange(vals[0]);
		},
		[onChange],
	);

	const display = formatValue ? formatValue(value) : String(value);

	return (
		<div className="flex items-center gap-3">
			<Slider
				variant="discord"
				value={[value]}
				onValueChange={handleChange}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				className="flex-1"
			/>
			{showValue && (
				<span className="min-w-[3ch] text-right text-sm font-medium tabular-nums text-discord-text">
					{display}
				</span>
			)}
		</div>
	);
}

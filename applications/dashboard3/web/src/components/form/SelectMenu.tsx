import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

interface SelectOption {
	value: string;
	label: string;
}

interface SelectMenuProps {
	value: string;
	onChange: (value: string) => void;
	options: SelectOption[] | readonly string[];
	placeholder?: string;
	disabled?: boolean;
}

function normalizeOptions(
	options: SelectOption[] | readonly string[],
): SelectOption[] {
	return options.map((opt) =>
		typeof opt === "string" ? { value: opt, label: opt } : opt,
	);
}

export function SelectMenu({
	value,
	onChange,
	options,
	placeholder = "Select an option",
	disabled,
}: SelectMenuProps) {
	const items = normalizeOptions(options);

	return (
		<Select value={value} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger variant="discord" className="w-full">
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent variant="discord">
				<SelectGroup>
					{items.map((item) => (
						<SelectItem key={item.value} variant="discord" value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

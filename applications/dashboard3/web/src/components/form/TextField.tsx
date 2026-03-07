import { Input } from "@/components/ui/input";
import { useCallback } from "react";

interface TextFieldProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	maxLength?: number;
	type?: "text" | "url" | "email";
}

export function TextField({
	value,
	onChange,
	placeholder,
	disabled,
	maxLength,
	type = "text",
}: TextFieldProps) {
	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			onChange(e.target.value);
		},
		[onChange],
	);

	return (
		<Input
			type={type}
			variant="discord"
			value={value}
			onChange={handleChange}
			placeholder={placeholder}
			disabled={disabled}
			maxLength={maxLength}
		/>
	);
}

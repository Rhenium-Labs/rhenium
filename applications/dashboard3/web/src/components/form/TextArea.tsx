import { cn } from "@/lib/utils";
import { useCallback } from "react";

interface TextAreaProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
	maxLength?: number;
	rows?: number;
}

export function TextArea({
	value,
	onChange,
	placeholder,
	disabled,
	maxLength,
	rows = 3,
}: TextAreaProps) {
	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			onChange(e.target.value);
		},
		[onChange],
	);

	return (
		<textarea
			value={value}
			onChange={handleChange}
			placeholder={placeholder}
			disabled={disabled}
			maxLength={maxLength}
			rows={rows}
			className={cn(
				"flex w-full rounded-md border px-3 py-2 text-sm transition-colors",
				"placeholder:text-discord-muted focus-visible:outline-none focus-visible:ring-2",
				"disabled:cursor-not-allowed disabled:opacity-50 resize-none",
				"border-discord-divider bg-discord-sidebar text-discord-text",
				"focus-visible:ring-discord-blurple focus-visible:ring-offset-discord-panel",
			)}
		/>
	);
}

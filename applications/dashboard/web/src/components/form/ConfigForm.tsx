import { type ReactNode, useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

interface ConfigFormProps<T extends Record<string, unknown>> {
	initialData: T;
	onSave: (data: Partial<T>) => void;
	isSaving: boolean;
	children: (props: {
		values: T;
		update: <K extends keyof T>(key: K, value: T[K]) => void;
		isDirty: boolean;
	}) => ReactNode;
}

export function ConfigForm<T extends Record<string, unknown>>({
	initialData,
	onSave,
	isSaving,
	children,
}: ConfigFormProps<T>) {
	const [values, setValues] = useState<T>(initialData);
	const [isDirty, setIsDirty] = useState(false);

	useEffect(() => {
		setValues(initialData);
		setIsDirty(false);
	}, [initialData]);

	const update = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
		setValues((prev) => ({ ...prev, [key]: value }));
		setIsDirty(true);
	}, []);

	function handleSave() {
		const changed: Partial<T> = {};
		for (const key in values) {
			if (JSON.stringify(values[key]) !== JSON.stringify(initialData[key])) {
				changed[key] = values[key];
			}
		}
		onSave(changed);
		setIsDirty(false);
	}

	function handleReset() {
		setValues(initialData);
		setIsDirty(false);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex-1 space-y-4 overflow-y-auto p-6">
				{children({ values, update, isDirty })}
			</div>
			{isDirty && (
				<div className="flex shrink-0 items-center justify-end gap-2 border-t border-discord-divider bg-discord-panel px-6 py-3">
					<button
						type="button"
						onClick={handleReset}
						disabled={isSaving}
						className="rounded-md px-4 py-2 text-sm font-medium text-discord-muted transition-colors hover:text-discord-text"
					>
						Reset
					</button>
					<button
						type="button"
						onClick={handleSave}
						disabled={isSaving}
						className={cn(
							"rounded-md bg-discord-success px-4 py-2 text-sm font-medium text-white transition-colors",
							"hover:bg-discord-success/80 disabled:cursor-not-allowed disabled:opacity-50",
						)}
					>
						{isSaving ? "Saving..." : "Save Changes"}
					</button>
				</div>
			)}
		</div>
	);
}

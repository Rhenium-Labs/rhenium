import { type ReactNode, useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import type { z } from "zod";

interface ConfigFormProps<T extends Record<string, unknown>> {
	initialData: T;
	onSave: (data: Partial<T>, full: T) => Promise<void>;
	isSaving: boolean;
	zodSchema?: z.ZodType<T>;
	children: (props: {
		values: T;
		update: <K extends keyof T>(key: K, value: T[K]) => void;
		isDirty: boolean;
		reset: () => void;
	}) => ReactNode;
}

const DEFAULT_MESSAGE = "Careful - you have unsaved changes!";

export function ConfigForm<T extends Record<string, unknown>>({
	initialData,
	onSave,
	isSaving,
	zodSchema,
	children,
}: ConfigFormProps<T>) {
	const [values, setValues] = useState<T>(initialData);
	const [isDirty, setIsDirty] = useState(false);
	const [barMessage, setBarMessage] = useState<string | null>(null);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [isBarExiting, setIsBarExiting] = useState(false);
	const hasShownBarRef = useRef(false);

	const { hasAttemptedNavigation, resetNavigationAttempt } =
		useUnsavedChangesGuard(isDirty);

	// Reset local state when server data changes.
	useEffect(() => {
		setValues(initialData);
		setIsDirty(false);
		setBarMessage(null);
		setValidationError(null);
		setIsBarExiting(false);
		hasShownBarRef.current = false;
		resetNavigationAttempt();
	}, [initialData, resetNavigationAttempt]);

	// Whenever we become dirty, ensure the default warning message is shown.
	useEffect(() => {
		if (isDirty && !barMessage) {
			setBarMessage(DEFAULT_MESSAGE);
		}
		if (!isDirty) {
			setBarMessage(null);
			setValidationError(null);
		}
		if (isDirty) {
			hasShownBarRef.current = true;
		}
	}, [isDirty, barMessage]);

	// Animate the bar out instead of instantly unmounting.
	useEffect(() => {
		if (isDirty) {
			setIsBarExiting(false);
			return;
		}

		// Only play exit animation if the bar was previously shown.
		if (!hasShownBarRef.current) {
			return;
		}

		setIsBarExiting(true);

		const t = window.setTimeout(() => setIsBarExiting(false), 140);
		return () => window.clearTimeout(t);
	}, [isDirty]);

	const update = useCallback(
		<K extends keyof T>(key: K, value: T[K]) => {
			setValues((prev) => ({ ...prev, [key]: value }));
			setIsDirty(true);
			setValidationError(null);
			setBarMessage(DEFAULT_MESSAGE);
			resetNavigationAttempt();
		},
		[resetNavigationAttempt],
	);

	const computeChanged = useCallback(
		(current: T, initial: T): Partial<T> => {
			const changed: Partial<T> = {};
			for (const key in current) {
				if (JSON.stringify(current[key]) !== JSON.stringify(initial[key])) {
					changed[key] = current[key];
				}
			}
			return changed;
		},
		[],
	);

	async function handleSave() {
		if (!isDirty || isSaving) return;

		// Top-level Zod validation if provided.
		if (zodSchema) {
			const parsed = zodSchema.safeParse(values);
			if (!parsed.success) {
				const first = parsed.error.issues[0];
				const message =
					first?.message ??
					parsed.error.message ??
					"Some fields are invalid. Please review your settings.";
				setValidationError(message);
				setBarMessage(message);
				return;
			}
		}

		const changed = computeChanged(values, initialData);
		if (Object.keys(changed).length === 0) {
			// Nothing to save; just clear dirty state.
			setIsDirty(false);
			setBarMessage(null);
			resetNavigationAttempt();
			return;
		}

		try {
			await onSave(changed, values);
			// Only on successful save do we consider the form clean.
			setIsDirty(false);
			setBarMessage(null);
			setValidationError(null);
			resetNavigationAttempt();
		} catch (error: unknown) {
			// Extract a human-friendly message from backend/TRPC error.
			let message = "Failed to save changes. Please try again.";
			if (error && typeof error === "object") {
				if ("message" in error && typeof (error as any).message === "string") {
					message = (error as any).message;
				}
			}
			setValidationError(message);
			setBarMessage(message);
		}
	}

	function handleReset() {
		setValues(initialData);
		setIsDirty(false);
		setBarMessage(null);
		setValidationError(null);
		resetNavigationAttempt();
	}

	const showBar = isDirty || isBarExiting;
	const isErrorState = Boolean(validationError);
	const isAttentionState = hasAttemptedNavigation && !isErrorState;

	return (
		<div className="relative flex h-full flex-col">
			<div
				className={cn(
					"flex-1 space-y-4 overflow-y-auto p-6",
					showBar && "pb-28",
				)}
			>
				{children({ values, update, isDirty, reset: handleReset })}
			</div>
			{showBar && (
				<div
					className={cn(
						"absolute bottom-4 left-6 right-6 z-20 flex items-center justify-between gap-3 rounded-lg border px-4 py-3",
						"bg-discord-panel/95 backdrop-blur-sm shadow-[0_-2px_10px_rgba(0,0,0,0.7)]",
						isDirty
							? "animate-in fade-in slide-in-from-bottom-2 duration-120 ease-out"
							: "animate-out fade-out slide-out-to-bottom-2 duration-140 ease-in",
						isErrorState
							? "border-destructive/70"
							: isAttentionState
								? "border-destructive/50"
								: "border-discord-divider",
					)}
				>
					<div className="min-w-0 flex-1">
						<p
							className={cn(
								"text-xs font-medium",
								isErrorState || isAttentionState
									? "text-destructive"
									: "text-discord-muted",
							)}
						>
							{barMessage ?? DEFAULT_MESSAGE}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="discordSecondary"
							size="sm"
							onClick={handleReset}
							disabled={isSaving}
						>
							Reset
						</Button>
						<Button
							type="button"
							variant={isErrorState ? "discordDanger" : "discordSuccess"}
							size="sm"
							onClick={handleSave}
							disabled={isSaving}
						>
							{isSaving ? "Saving..." : "Save Changes"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

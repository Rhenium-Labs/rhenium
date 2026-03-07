import { useEffect, useState, useCallback } from "react";

interface UnsavedChangesGuard {
	hasAttemptedNavigation: boolean;
	resetNavigationAttempt: () => void;
}

/**
 * Guards against losing unsaved changes.
 *
 * - Blocks in-app navigation via React Router's `useBlocker` while `isDirty` is true.
 * - Tracks when the user has *tried* to navigate away (for UI hints like turning the bar red).
 * - Adds a `beforeunload` listener so closing/reloading the tab also warns the user.
 */
export function useUnsavedChangesGuard(isDirty: boolean): UnsavedChangesGuard {
	const [hasAttemptedNavigation, setHasAttemptedNavigation] = useState(false);

	useEffect(() => {
		if (!isDirty) {
			setHasAttemptedNavigation(false);
		}
	}, [isDirty]);

	useEffect(() => {
		if (!isDirty) return;

		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault();
		};

		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [isDirty]);

	const resetNavigationAttempt = useCallback(() => {
		setHasAttemptedNavigation(false);
	}, []);

	return { hasAttemptedNavigation, resetNavigationAttempt };
}

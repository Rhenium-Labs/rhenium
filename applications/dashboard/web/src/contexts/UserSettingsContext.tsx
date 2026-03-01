import {
	createContext,
	useCallback,
	useContext,
	useState,
	type ReactNode,
} from "react";

type UserSettingsContextValue = {
	isOpen: boolean;
	open: () => void;
	close: () => void;
};

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);

	return (
		<UserSettingsContext.Provider value={{ isOpen, open, close }}>
			{children}
		</UserSettingsContext.Provider>
	);
}

export function useUserSettings() {
	const ctx = useContext(UserSettingsContext);
	if (!ctx) {
		throw new Error("useUserSettings must be used within UserSettingsProvider");
	}
	return ctx;
}

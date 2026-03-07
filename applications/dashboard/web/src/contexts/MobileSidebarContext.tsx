import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

export type MobileSidebarContextValue = {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
};

const MobileSidebarContext = createContext<MobileSidebarContextValue | null>(null);

export function MobileSidebarProvider({ children }: { children: ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);
	const toggle = useCallback(() => setIsOpen((p) => !p), []);

	return (
		<MobileSidebarContext.Provider value={{ isOpen, open, close, toggle }}>
			{children}
		</MobileSidebarContext.Provider>
	);
}

export function useMobileSidebar() {
	const ctx = useContext(MobileSidebarContext);
	if (!ctx) {
		throw new Error("useMobileSidebar must be used within MobileSidebarProvider");
	}
	return ctx;
}

/** Returns true when viewport is below Tailwind's md breakpoint (768px). */
export function useIsMobile() {
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		const mql = window.matchMedia("(max-width: 767px)");
		const handler = () => setIsMobile(mql.matches);
		handler();
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	return isMobile;
}

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
	id: string;
	username: string;
	avatar: string | null;
}

interface AuthState {
	token: string | null;
	user: AuthUser | null;
	isLoading: boolean;
	setToken: (token: string | null) => void;
	setUser: (user: AuthUser | null) => void;
	setLoading: (loading: boolean) => void;
	login: (token: string, user: AuthUser) => void;
	logout: () => void;
}

export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			token: null,
			user: null,
			isLoading: false,
			setToken: (token) => set({ token }),
			setUser: (user) => set({ user }),
			setLoading: (isLoading) => set({ isLoading }),
			login: (token, user) => set({ token, user }),
			logout: () => set({ token: null, user: null }),
		}),
		{ name: "rhenium-auth", partialize: (s) => ({ token: s.token, user: s.user }) }
	)
);

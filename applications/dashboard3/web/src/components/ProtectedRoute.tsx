import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuthStore } from "@/stores/auth";

interface ProtectedRouteProps {
	children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
	const { token } = useAuthStore();
	const location = useLocation();

	if (!token) {
		return <Navigate to="/" state={{ from: location }} replace />;
	}

	return <>{children}</>;
}

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { trpc, createTRPCClient, isUnauthorizedError } from "@/lib/trpc";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GuildProvider } from "@/contexts/GuildContext";
import { GuildSettingsLayout } from "@/components/guild/GuildSettingsLayout";
import { useAuthStore } from "@/stores/auth";
import { GuildService } from "@/service/guild";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PageSkeleton } from "@/components/PageSkeleton";

// Lazy-loaded pages — each is code-split into its own chunk
const HomePage = lazy(() => import("@/pages/HomePage").then(m => ({ default: m.HomePage })));
const LoginCallbackPage = lazy(() => import("@/pages/LoginCallbackPage").then(m => ({ default: m.LoginCallbackPage })));
const HomeDashboardContent = lazy(() => import("@/pages/HomeDashboardContent").then(m => ({ default: m.HomeDashboardContent })));
const GuildDashboardPage = lazy(() => import("@/pages/GuildDashboardPage").then(m => ({ default: m.GuildDashboardPage })));
const MessageReportsPage = lazy(() => import("@/pages/features/MessageReportsPage").then(m => ({ default: m.MessageReportsPage })));
const BanRequestsPage = lazy(() => import("@/pages/features/BanRequestsPage").then(m => ({ default: m.BanRequestsPage })));
const ContentFilterPage = lazy(() => import("@/pages/features/ContentFilterPage").then(m => ({ default: m.ContentFilterPage })));
const HighlightsPage = lazy(() => import("@/pages/features/HighlightsPage").then(m => ({ default: m.HighlightsPage })));
const QuickMutesPage = lazy(() => import("@/pages/features/QuickMutesPage").then(m => ({ default: m.QuickMutesPage })));
const QuickPurgesPage = lazy(() => import("@/pages/features/QuickPurgesPage").then(m => ({ default: m.QuickPurgesPage })));
const LoggingPage = lazy(() => import("@/pages/features/LoggingPage").then(m => ({ default: m.LoggingPage })));
const TemporaryBansPage = lazy(() => import("@/pages/features/TemporaryBansPage").then(m => ({ default: m.TemporaryBansPage })));

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (failureCount, error) => {
				if (isUnauthorizedError(error)) return false;
				return failureCount < 3;
			},
		},
		mutations: {
			retry: false,
		},
	},
});
const trpcClient = createTRPCClient();

function LegacySettingsRoute() {
	const { guildId, configName } = useParams<{ guildId: string; configName?: string }>();

	if (!guildId) {
		return <Navigate to="/" replace />;
	}

	const target = configName
		? `/guilds/${guildId}/settings/${configName}`
		: `/guilds/${guildId}/settings/message-reports`;

	return <Navigate to={target} replace />;
}

function App() {
	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<trpc.Provider client={trpcClient} queryClient={queryClient}>
				<QueryClientProvider client={queryClient}>
					<Routes>
						<Route path="/login" element={<Navigate to="/" replace />} />
						<Route path="/login/callback" element={<Suspense fallback={<LoadingScreen />}><LoginCallbackPage /></Suspense>} />
						<Route path="/" element={<HomeRoute />} />

						<Route
							path="/home"
							element={
								<ProtectedRoute>
									<HomeWithServers />
								</ProtectedRoute>
							}
						/>

						<Route
							path="/guilds/:guildId"
							element={
								<ProtectedRoute>
									<DashboardLayout>
										<GuildProvider>
											<Suspense fallback={<PageSkeleton />}>
												<GuildDashboardPage />
											</Suspense>
										</GuildProvider>
									</DashboardLayout>
								</ProtectedRoute>
							}
						/>

						<Route
							path="/guilds/:guildId/settings/*"
							element={
								<ProtectedRoute>
									<DashboardLayout>
										<GuildProvider>
											<GuildSettingsLayout>
												<Suspense fallback={<PageSkeleton />}>
													<Routes>
														<Route path="message-reports" element={<MessageReportsPage />} />
														<Route path="ban-requests" element={<BanRequestsPage />} />
														<Route path="content-filter" element={<ContentFilterPage />} />
														<Route path="highlights" element={<HighlightsPage />} />
														<Route path="quick-mutes" element={<QuickMutesPage />} />
														<Route path="quick-purges" element={<QuickPurgesPage />} />
														<Route path="logging" element={<LoggingPage />} />
														<Route path="temporary-bans" element={<TemporaryBansPage />} />
														<Route path="*" element={<Navigate to="message-reports" replace />} />
													</Routes>
												</Suspense>
											</GuildSettingsLayout>
										</GuildProvider>
									</DashboardLayout>
								</ProtectedRoute>
							}
						/>

						{/* Short URL: /settings/:guildId/:configName -> /guilds/:guildId/settings/:configName */}
						<Route
							path="/settings/:guildId/:configName?"
							element={
								<ProtectedRoute>
									<LegacySettingsRoute />
								</ProtectedRoute>
							}
						/>

						<Route path="*" element={<Navigate to="/" replace />} />
					</Routes>
				</QueryClientProvider>
			</trpc.Provider>
		</ThemeProvider>
	);
}

function HomeWithServers() {
	const { isLoading } = GuildService.useUserGuilds();

	if (isLoading) {
		return <LoadingScreen />;
	}

	return (
		<DashboardLayout>
			<Suspense fallback={<PageSkeleton />}>
				<HomeDashboardContent />
			</Suspense>
		</DashboardLayout>
	);
}

function HomeRoute() {
	const { token } = useAuthStore();
	if (token) {
		return <Navigate to="/home" replace />;
	}
	return <Suspense fallback={<LoadingScreen />}><HomePage /></Suspense>;
}

export default App;

import { Routes, Route, Navigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { trpc, createTRPCClient } from "@/lib/trpc";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GuildProvider } from "@/contexts/GuildContext";
import { HomePage } from "@/pages/HomePage";
import { LoginCallbackPage } from "@/pages/LoginCallbackPage";
import { GuildDashboardPage } from "@/pages/GuildDashboardPage";
import { GuildSettingsLayout } from "@/components/guild/GuildSettingsLayout";
import { MessageReportsPage } from "@/pages/features/MessageReportsPage";
import { BanRequestsPage } from "@/pages/features/BanRequestsPage";
import { ContentFilterPage } from "@/pages/features/ContentFilterPage";
import { HighlightsPage } from "@/pages/features/HighlightsPage";
import { QuickMutesPage } from "@/pages/features/QuickMutesPage";
import { QuickPurgesPage } from "@/pages/features/QuickPurgesPage";
import { LoggingPage } from "@/pages/features/LoggingPage";
import { TemporaryBansPage } from "@/pages/features/TemporaryBansPage";
import { useAuthStore } from "@/stores/auth";
import { HomeDashboardContent } from "@/pages/HomeDashboardContent";

const queryClient = new QueryClient();
const trpcClient = createTRPCClient();

function App() {
	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<trpc.Provider client={trpcClient} queryClient={queryClient}>
				<QueryClientProvider client={queryClient}>
					<Routes>
						<Route path="/login" element={<Navigate to="/" replace />} />
						<Route path="/login/callback" element={<LoginCallbackPage />} />
						<Route path="/" element={<HomeRoute />} />

						<Route
							path="/home"
							element={
								<ProtectedRoute>
									<DashboardLayout>
										<HomeDashboardContent />
									</DashboardLayout>
								</ProtectedRoute>
							}
						/>

						<Route
							path="/guilds/:guildId"
							element={
								<ProtectedRoute>
									<DashboardLayout>
										<GuildProvider>
											<GuildDashboardPage />
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
											</GuildSettingsLayout>
										</GuildProvider>
									</DashboardLayout>
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

function HomeRoute() {
	const { token } = useAuthStore();
	if (token) {
		return <Navigate to="/home" replace />;
	}
	return <HomePage />;
}

export default App;

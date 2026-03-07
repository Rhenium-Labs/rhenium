import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "@/app/App.tsx";
import { BrowserRouter } from "react-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ErrorBoundary>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</ErrorBoundary>
	</StrictMode>
);

import { Component, type ReactNode } from "react";
import { ServerErrorFallback } from "@/components/ServerErrorFallback";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	render() {
		if (this.state.hasError) {
			return <ServerErrorFallback />;
		}
		return this.props.children;
	}
}

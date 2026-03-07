import type { ReactNode } from "react";

interface SubSectionProps {
	id: string;
	title: string;
	children: ReactNode;
}

export function SubSection({ id, title, children }: SubSectionProps) {
	return (
		<div id={id} className="space-y-3">
			<h3 className="text-sm font-medium text-discord-text">{title}</h3>
			<div className="text-discord-muted">{children}</div>
		</div>
	);
}

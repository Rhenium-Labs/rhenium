import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BaseModalProps {
	isOpen: boolean;
	onClose: () => void;
	children: React.ReactNode;
	className?: string;
}

export function BaseModal({
	isOpen,
	onClose,
	children,
	className = "h-full w-full md:h-[min(80vh,480px)] md:w-[min(90vw,640px)]",
}: BaseModalProps) {
	if (!isOpen) return null;

	return createPortal(
		<>
			<div
				className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
				aria-hidden
			/>
			<div
				className={cn(
					"fixed z-50 flex flex-col overflow-hidden bg-discord-panel shadow-2xl",
					// Mobile: full-screen \"page\" layout
					"inset-0 rounded-none md:inset-auto",
					// Desktop: centered floating modal
					"md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl",
					className,
				)}
				role="dialog"
				aria-modal="true"
			>
				{children}
			</div>
		</>,
		document.body
	);
}

interface BaseModalHeaderProps {
	onClose: () => void;
	children?: React.ReactNode;
}

export function BaseModalHeader({ onClose, children }: BaseModalHeaderProps) {
	return (
		<div className="flex shrink-0 items-center justify-between gap-4 border-b border-discord-divider px-4 py-3">
			<div className="min-w-0 flex-1">{children}</div>
			<button
				type="button"
				onClick={onClose}
				className="rounded p-1.5 text-discord-text transition-colors hover:bg-discord-hover"
				aria-label="Close"
			>
				<X className="size-5" />
			</button>
		</div>
	);
}

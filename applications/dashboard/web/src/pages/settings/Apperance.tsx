import { SubSection } from "@/components/settings/SubSection";
import { useTheme } from "@/components/theme/ThemeProvider";

const THEME_SWATCHES: { id: "light" | "dark"; color: string; label: string }[] = [
	{ id: "light", color: "#ffffff", label: "Light" },
	{ id: "dark", color: "#313338", label: "Dark" },
];

export function AppearanceSection() {
	const { theme, setTheme } = useTheme();

	return (
		<SubSection id="theme" title="Theme">
			<div className="flex gap-3">
				{THEME_SWATCHES.map(({ id, color, label }) => (
					<ThemeOption
						key={id}
						color={color}
						label={label}
						isActive={theme === id}
						onClick={() => setTheme(id)}
					/>
				))}
			</div>
		</SubSection>
	);
}

interface ThemeOptionProps {
	color: string;
	label: string;
	isActive: boolean;
	onClick: () => void;
}

function ThemeOption({ color, label, isActive, onClick }: ThemeOptionProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`flex flex-col items-center gap-2 transition-colors outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${
				isActive ? "" : "hover:opacity-90 active:opacity-80"
			}`}
		>
			<div
				className="size-14 shrink-0 rounded-lg border-2 border-white"
				style={{ backgroundColor: color }}
			/>
			<span className="text-xs font-medium text-discord-muted">{label}</span>
		</button>
	);
}

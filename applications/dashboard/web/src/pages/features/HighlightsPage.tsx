import { HighlightsService } from "@/service/highlights";
import { useGuild } from "@/contexts/GuildContext";
import { ConfigForm, ToggleSwitch, NumberInput } from "@/components/form";
import { LoadingScreen } from "@/components/LoadingScreen";

export function HighlightsPage() {
	const { guildId } = useGuild();
	const { data: config, isLoading, error } = HighlightsService.useConfig(guildId);
	const { mutate: updateConfig, isPending } = HighlightsService.useUpdateConfig(guildId);

	if (isLoading) return <LoadingScreen className="relative bg-transparent" />;
	if (error || !config) {
		return <div className="p-6 text-sm text-discord-muted">{error ?? "Config not found"}</div>;
	}

	return (
		<ConfigForm
			initialData={config}
			onSave={(data) => updateConfig({ guildId, data })}
			isSaving={isPending}
		>
			{({ values, update }) => (
				<>
					<h2 className="text-lg font-bold text-discord-text">Highlights</h2>
					<p className="text-sm text-discord-muted">
						Get notified when keywords you care about are mentioned.
					</p>

					<ToggleSwitch
						label="Enable Highlights"
						description="Toggle the highlights feature on or off."
						checked={values.enabled}
						onChange={(v) => update("enabled", v)}
					/>

					<NumberInput
						label="Max Patterns Per User"
						description="Maximum number of highlight patterns a user can set."
						value={values.max_patterns}
						onChange={(v) => update("max_patterns", v)}
						min={1}
						max={30}
					/>
				</>
			)}
		</ConfigForm>
	);
}

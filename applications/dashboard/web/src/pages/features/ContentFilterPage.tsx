import { ContentFilterService } from "@/service/content-filter";
import { useGuild } from "@/contexts/GuildContext";
import { ConfigForm, ToggleSwitch, ChannelSelect, RoleSelect, DataTable } from "@/components/form";
import { LoadingScreen } from "@/components/LoadingScreen";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { useState } from "react";

const DETECTORS = ["NSFW", "OCR", "TEXT"] as const;
const DETECTOR_MODES = ["Lenient", "Medium", "Strict"] as const;
const VERBOSITY_LEVELS = ["Minimal", "Medium", "Verbose"] as const;

export function ContentFilterPage() {
	const { guildId } = useGuild();
	const { data: config, isLoading, error } = ContentFilterService.useConfig(guildId);
	const { data: scoping } = ContentFilterService.useChannelScoping(guildId);
	const { mutate: updateConfig, isPending } = ContentFilterService.useUpdateConfig(guildId);
	const { mutate: setScope } = ContentFilterService.useSetChannelScope(guildId);
	const { mutate: removeScope } = ContentFilterService.useRemoveChannelScope(guildId);

	const [newScopeChannel, setNewScopeChannel] = useState<string | null>(null);
	const [newScopeType, setNewScopeType] = useState<0 | 1>(0);

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
					<h2 className="text-lg font-bold text-discord-text">Content Filter</h2>
					<p className="text-sm text-discord-muted">
						Automatically detect and filter inappropriate content.
					</p>

					<ToggleSwitch
						label="Enable Content Filter"
						checked={values.enabled}
						onChange={(v) => update("enabled", v)}
					/>

					<ToggleSwitch
						label="Use Native AutoMod"
						description="Use Discord's native AutoMod in conjunction with the content filter."
						checked={values.use_native_automod}
						onChange={(v) => update("use_native_automod", v)}
					/>

					<div className="space-y-1.5">
						<label className="text-xs font-medium uppercase tracking-wider text-discord-muted">
							Detectors
						</label>
						<div className="flex flex-wrap gap-2">
							{DETECTORS.map((detector) => {
								const active = values.detectors.includes(detector);
								return (
									<button
										key={detector}
										type="button"
										onClick={() => {
											const next = active
												? values.detectors.filter((d) => d !== detector)
												: [...values.detectors, detector];
											update("detectors", next);
										}}
										className={cn(
											"rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
											active
												? "border-discord-blurple bg-discord-blurple/20 text-discord-text"
												: "border-discord-divider text-discord-muted hover:text-discord-text",
										)}
									>
										{detector}
									</button>
								);
							})}
						</div>
					</div>

					<SelectGroup
						label="Detector Mode"
						value={values.detector_mode}
						options={DETECTOR_MODES}
						onChange={(v) => update("detector_mode", v)}
					/>

					<SelectGroup
						label="Verbosity"
						value={values.verbosity}
						options={VERBOSITY_LEVELS}
						onChange={(v) => update("verbosity", v)}
					/>

					<RoleSelect
						guildId={guildId}
						value={values.immune_roles}
						onChange={(v) => update("immune_roles", v)}
						label="Immune Roles"
					/>

					<RoleSelect
						guildId={guildId}
						value={values.notify_roles}
						onChange={(v) => update("notify_roles", v)}
						label="Notify Roles"
					/>

					<div className="space-y-3 pt-4">
						<h3 className="text-sm font-semibold text-discord-text">Channel Scoping</h3>
						<DataTable
							columns={[
								{ key: "channel_id", header: "Channel ID", render: (r) => r.channel_id },
								{ key: "type", header: "Type", render: (r) => (r.type === 0 ? "Whitelist" : "Blacklist") },
								{
									key: "actions",
									header: "",
									className: "w-12",
									render: (r) => (
										<button
											type="button"
											onClick={() => removeScope({ guildId, channelId: r.channel_id })}
											className="text-discord-muted transition-colors hover:text-destructive"
										>
											<Trash2 className="size-4" />
										</button>
									),
								},
							]}
							data={scoping ?? []}
							keyExtractor={(r) => r.channel_id}
							emptyMessage="No channel scoping configured"
						/>
						<div className="flex items-end gap-2">
							<ChannelSelect
								guildId={guildId}
								value={newScopeChannel}
								onChange={setNewScopeChannel}
								label="Add Channel"
								filterTypes={[0]}
							/>
							<select
								value={newScopeType}
								onChange={(e) => setNewScopeType(Number(e.target.value) as 0 | 1)}
								className="rounded-md border border-discord-divider bg-discord-sidebar px-3 py-2 text-sm text-discord-text"
							>
								<option value={0}>Whitelist</option>
								<option value={1}>Blacklist</option>
							</select>
							<button
								type="button"
								disabled={!newScopeChannel}
								onClick={() => {
									if (newScopeChannel) {
										setScope({ guildId, channelId: newScopeChannel, data: { type: newScopeType } });
										setNewScopeChannel(null);
									}
								}}
								className="rounded-md bg-discord-blurple px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-discord-blurple/80 disabled:opacity-50"
							>
								Add
							</button>
						</div>
					</div>
				</>
			)}
		</ConfigForm>
	);
}

function SelectGroup<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: readonly T[];
	onChange: (value: T) => void;
}) {
	return (
		<div className="space-y-1.5">
			<label className="text-xs font-medium uppercase tracking-wider text-discord-muted">
				{label}
			</label>
			<div className="flex gap-2">
				{options.map((opt) => (
					<button
						key={opt}
						type="button"
						onClick={() => onChange(opt)}
						className={cn(
							"rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
							value === opt
								? "border-discord-blurple bg-discord-blurple/20 text-discord-text"
								: "border-discord-divider text-discord-muted hover:text-discord-text",
						)}
					>
						{opt}
					</button>
				))}
			</div>
		</div>
	);
}

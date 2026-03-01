import { QuickPurgesService } from "@/service/quick-purges";
import { useGuild } from "@/contexts/GuildContext";
import { ConfigForm, ToggleSwitch, NumberInput, ChannelSelect, DataTable } from "@/components/form";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Trash2 } from "lucide-react";
import { useState } from "react";

export function QuickPurgesPage() {
	const { guildId } = useGuild();
	const { data: config, isLoading, error } = QuickPurgesService.useConfig(guildId);
	const { data: scoping } = QuickPurgesService.useChannelScoping(guildId);
	const { mutate: updateConfig, isPending } = QuickPurgesService.useUpdateConfig(guildId);
	const { mutate: setScope } = QuickPurgesService.useSetChannelScope(guildId);
	const { mutate: removeScope } = QuickPurgesService.useRemoveChannelScope(guildId);

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
					<h2 className="text-lg font-bold text-discord-text">Quick Purges</h2>
					<p className="text-sm text-discord-muted">
						Bulk delete messages from channels efficiently.
					</p>

					<ToggleSwitch
						label="Enable Quick Purges"
						checked={values.enabled}
						onChange={(v) => update("enabled", v)}
					/>

					<NumberInput
						label="Max Purge Limit"
						description="Maximum number of messages that can be purged at once."
						value={values.max_limit}
						onChange={(v) => update("max_limit", v)}
						min={2}
						max={500}
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

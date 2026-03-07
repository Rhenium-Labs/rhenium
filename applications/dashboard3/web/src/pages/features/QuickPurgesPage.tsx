import { QuickPurgesService } from "@/service/quick-purges";
import { GuildService } from "@/service/guild";
import { useGuild } from "@/contexts/GuildContext";
import { ConfigForm, ToggleSwitch, NumberInput, ChannelSelect, DataTable } from "@/components/form";
import { SettingsLoading } from "@/components/SettingsLoading";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDiscordCacheStore } from "@/stores/discord-cache";

export function QuickPurgesPage() {
	const { guildId } = useGuild();
	const { data: config, isLoading, error } = QuickPurgesService.useConfig(guildId);
	const { mutateAsync: updateConfig, isPending } = QuickPurgesService.useUpdateConfig(guildId);

	GuildService.useCachedChannels(guildId);
	const channelCache = useDiscordCacheStore((s) => s.channels[guildId]);

	const [newScopeChannel, setNewScopeChannel] = useState<string | null>(null);
	const [newScopeType, setNewScopeType] = useState<0 | 1>(0);

	if (isLoading) return <SettingsLoading />;
	if (error || !config) {
		return <div className="p-6 text-sm text-discord-muted">{error ?? "Config not found"}</div>;
	}

	return (
		<ConfigForm
			initialData={config}
			onSave={async (data) => { await updateConfig({ guildId, data }); }}
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

					{values.enabled && (
						<>
							<NumberInput
								label="Max Purge Limit"
								description="Maximum number of messages that can be purged at once."
								value={values.max_limit}
								onChange={(v) => update("max_limit", v)}
								min={2}
								max={500}
							/>

							<div className="space-y-3 pt-4">
								<h3 className="text-sm font-semibold text-discord-text">
									Channel Scoping
								</h3>
								<DataTable
									columns={[
									{ key: "channel_id", header: "Channel ID", render: (r) => r.channel_id },
									{ key: "channel_name", header: "Channel Name", render: (r) => {
										const cached = channelCache?.data.find(c => c.id === r.channel_id);
										return cached ? `# ${cached.name}` : "Unknown";
									}},
									{ key: "type", header: "Type", render: (r) => (r.type === 0 ? "Whitelist" : "Blacklist") },
									{
										key: "actions",
										header: "",
										className: "w-12",
										render: (r) => (
											<button
												type="button"
												onClick={() => update("channel_scoping", values.channel_scoping.filter(
													s => s.channel_id !== r.channel_id
												))}
												className="text-discord-muted transition-colors hover:text-destructive"
											>
												<Trash2 className="size-4" />
											</button>
										),
									},
								]}
								data={values.channel_scoping}
								keyExtractor={(r) => r.channel_id}
								emptyMessage="No channel scoping configured"
								/>

								<div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
									<div className="min-w-0 sm:flex-1">
										<ChannelSelect
											guildId={guildId}
											value={newScopeChannel}
											onChange={setNewScopeChannel}
											label="Add Channel"
											filterTypes={[0]}
										/>
									</div>
									<select
										value={newScopeType}
										onChange={(e) => setNewScopeType(Number(e.target.value) as 0 | 1)}
										className="w-full rounded-md border border-discord-divider bg-discord-sidebar px-3 py-2 text-sm text-discord-text sm:w-40"
									>
										<option value={0}>Whitelist</option>
										<option value={1}>Blacklist</option>
									</select>
									<Button
										type="button"
										variant="discordPrimary"
										disabled={!newScopeChannel}
										onClick={() => {
											if (newScopeChannel) {
												const existing = values.channel_scoping.find(
													s => s.channel_id === newScopeChannel
												);
												if (existing) {
													if (existing.type !== newScopeType) {
														update("channel_scoping", values.channel_scoping.map(
															s => s.channel_id === newScopeChannel ? { ...s, type: newScopeType } : s
														));
													}
												} else {
													update("channel_scoping", [
														...values.channel_scoping,
														{ channel_id: newScopeChannel, type: newScopeType },
													]);
												}
												setNewScopeChannel(null);
											}
										}}
										className="w-full px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-discord-blurple/80 disabled:opacity-50 sm:w-24"
									>
										Add
									</Button>
								</div>
							</div>
						</>
					)}
				</>
			)}
		</ConfigForm>
	);
}


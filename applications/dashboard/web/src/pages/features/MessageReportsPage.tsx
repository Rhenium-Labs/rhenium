import { MessageReportsService } from "@/service/message-reports";
import { useGuild } from "@/contexts/GuildContext";
import {
	ConfigForm,
	ToggleSwitch,
	ChannelSelect,
	RoleSelect,
	NumberInput,
	Setting,
	SettingTitle,
	SettingSubtitle
} from "@/components/form";
import { SettingsLoading } from "@/components/SettingsLoading";

export function MessageReportsPage() {
	const { guildId } = useGuild();
	const { data: config, isLoading, error } = MessageReportsService.useConfig(guildId);
	const { mutateAsync: updateConfig, isPending } =
		MessageReportsService.useUpdateConfig(guildId);

	if (isLoading) return <SettingsLoading />;
	if (error || !config) {
		return (
			<div className="p-6 text-sm text-discord-muted">{error ?? "Config not found"}</div>
		);
	}

	return (
		<ConfigForm
			initialData={config}
			onSave={async data => {
				await updateConfig({ guildId, data });
			}}
			isSaving={isPending}
		>
			{({ values, update }) => (
				<>
					<div className="space-y-1">
						<h2 className="text-lg font-bold text-discord-text">
							Message Reports
						</h2>
						<p className="text-sm text-discord-muted">
							Allow members to report messages to staff for review.
						</p>
					</div>

					<Setting>
						<SettingTitle>Enable Message Reports</SettingTitle>
						<SettingSubtitle>
							Toggle the message reports feature on or off.
						</SettingSubtitle>
						<ToggleSwitch
							label="Enable Message Reports"
							checked={values.enabled}
							onChange={v => update("enabled", v)}
						/>
					</Setting>

					{values.enabled && (
						<>
							<Setting>
								<SettingTitle>Report Channel</SettingTitle>
								<SettingSubtitle>
									Choose the channel where report notifications will be
									sent.
								</SettingSubtitle>
								<ChannelSelect
									guildId={guildId}
									value={values.webhook_channel ?? null}
									onChange={v => update("webhook_channel", v)}
									label="Report Channel"
									filterTypes={[0]}
								/>
							</Setting>

							<Setting>
								<SettingTitle>Auto-Disregard After</SettingTitle>
								<SettingSubtitle>
									Automatically disregard reports after this many
									seconds. Set to 0 to disable.
								</SettingSubtitle>
								<NumberInput
									label="Auto-Disregard After (seconds)"
									value={Number(values.auto_disregard_after)}
									onChange={v => update("auto_disregard_after", String(v))}
									min={0}
								/>
							</Setting>

							<Setting>
								<SettingTitle>Delete Submission on Handle</SettingTitle>
								<SettingSubtitle>
									Delete the report submission message when a moderator
									handles it.
								</SettingSubtitle>
								<ToggleSwitch
									label="Delete Submission on Handle"
									checked={values.delete_submission_on_handle}
									onChange={v =>
										update("delete_submission_on_handle", v)
									}
								/>
							</Setting>

							<Setting>
								<SettingTitle>Enforce Member in Guild</SettingTitle>
								<SettingSubtitle>
									Only accept reports from members currently in the
									server.
								</SettingSubtitle>
								<ToggleSwitch
									label="Enforce Member in Guild"
									checked={values.enforce_member_in_guild}
									onChange={v => update("enforce_member_in_guild", v)}
								/>
							</Setting>

							<Setting>
								<SettingTitle>Enforce Report Reason</SettingTitle>
								<SettingSubtitle>
									Require reporters to provide a reason with their
									report.
								</SettingSubtitle>
								<ToggleSwitch
									label="Enforce Report Reason"
									checked={values.enforce_report_reason}
									onChange={v => update("enforce_report_reason", v)}
								/>
							</Setting>

							<Setting>
								<SettingTitle>Immune Roles</SettingTitle>
								<SettingSubtitle>
									Members with these roles cannot be reported.
								</SettingSubtitle>
								<RoleSelect
									guildId={guildId}
									value={values.immune_roles}
									onChange={v => update("immune_roles", v)}
									label="Immune Roles"
								/>
							</Setting>

							<Setting>
								<SettingTitle>Notify Roles</SettingTitle>
								<SettingSubtitle>
									Members with these roles will be notified about new
									reports.
								</SettingSubtitle>
								<RoleSelect
									guildId={guildId}
									value={values.notify_roles}
									onChange={v => update("notify_roles", v)}
									label="Notify Roles"
								/>
							</Setting>
						</>
					)}
				</>
			)}
		</ConfigForm>
	);
}

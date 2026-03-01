import { MessageReportsService } from "@/service/message-reports";
import { useGuild } from "@/contexts/GuildContext";
import { ConfigForm, ToggleSwitch, ChannelSelect, RoleSelect, NumberInput } from "@/components/form";
import { LoadingScreen } from "@/components/LoadingScreen";

export function MessageReportsPage() {
	const { guildId } = useGuild();
	const { data: config, isLoading, error } = MessageReportsService.useConfig(guildId);
	const { mutate: updateConfig, isPending } = MessageReportsService.useUpdateConfig(guildId);

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
					<h2 className="text-lg font-bold text-discord-text">Message Reports</h2>
					<p className="text-sm text-discord-muted">
						Allow members to report messages to staff for review.
					</p>

					<ToggleSwitch
						label="Enable Message Reports"
						description="Toggle the message reports feature on or off."
						checked={values.enabled}
						onChange={(v) => update("enabled", v)}
					/>

					<ChannelSelect
						guildId={guildId}
						value={values.webhook_channel}
						onChange={(v) => update("webhook_channel", v)}
						label="Report Channel"
						filterTypes={[0]}
					/>

					<NumberInput
						label="Auto-Disregard After (seconds)"
						description="Automatically disregard reports after this many seconds. Set to 0 to disable."
						value={values.auto_disregard_after}
						onChange={(v) => update("auto_disregard_after", v)}
						min={0}
					/>

					<ToggleSwitch
						label="Delete Submission on Handle"
						description="Delete the report submission message when a moderator handles it."
						checked={values.delete_submission_on_handle}
						onChange={(v) => update("delete_submission_on_handle", v)}
					/>

					<ToggleSwitch
						label="Enforce Member in Guild"
						description="Only accept reports from members currently in the server."
						checked={values.enforce_member_in_guild}
						onChange={(v) => update("enforce_member_in_guild", v)}
					/>

					<ToggleSwitch
						label="Enforce Report Reason"
						description="Require reporters to provide a reason with their report."
						checked={values.enforce_report_reason}
						onChange={(v) => update("enforce_report_reason", v)}
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
				</>
			)}
		</ConfigForm>
	);
}

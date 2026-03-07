import { BanRequestsService } from "@/service/ban-requests";
import { useGuild } from "@/contexts/GuildContext";
import { ConfigForm, ToggleSwitch, ChannelSelect, RoleSelect } from "@/components/form";
import { SettingsLoading } from "@/components/SettingsLoading";

export function BanRequestsPage() {
	const { guildId } = useGuild();
	const { data: config, isLoading, error } = BanRequestsService.useConfig(guildId);
	const { mutateAsync: updateConfig, isPending } = BanRequestsService.useUpdateConfig(guildId);

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
					<h2 className="text-lg font-bold text-discord-text">Ban Requests</h2>
					<p className="text-sm text-discord-muted">
						Enable staff to submit and review ban requests.
					</p>

					<ToggleSwitch
						label="Enable Ban Requests"
						description="Toggle the ban requests feature on or off."
						checked={values.enabled}
						onChange={(v) => update("enabled", v)}
					/>

					{values.enabled && (
						<>
							<ChannelSelect
								guildId={guildId}
								value={values.webhook_channel ?? null}
								onChange={(v) => update("webhook_channel", v)}
								label="Request Channel"
								filterTypes={[0]}
							/>

							<ToggleSwitch
								label="Automatically Timeout"
								description="Automatically timeout the user while the ban request is being reviewed."
								checked={values.automatically_timeout}
								onChange={(v) => update("automatically_timeout", v)}
							/>

							<ToggleSwitch
								label="Enforce Submission Reason"
								description="Require a reason when submitting a ban request."
								checked={values.enforce_submission_reason}
								onChange={(v) => update("enforce_submission_reason", v)}
							/>

							<ToggleSwitch
								label="Enforce Deny Reason"
								description="Require a reason when denying a ban request."
								checked={values.enforce_deny_reason}
								onChange={(v) => update("enforce_deny_reason", v)}
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
				</>
			)}
		</ConfigForm>
	);
}

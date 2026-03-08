<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { Ban } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import RoleSelector from "$lib/components/RoleSelector.svelte";
	import Select from "$lib/components/Select.svelte";
	import type { SelectOption } from "$lib/components/Select.svelte";
	import type { PageData } from "./$types";
	import type { ChannelInfo, RoleInfo } from "@repo/trpc";

	let { data }: { data: PageData } = $props();

	const config = $derived(data.guild.config.ban_requests);
	const channels: ChannelInfo[] = $derived(
		data.channels.filter((c: ChannelInfo) => c.type === 0 || c.type === 5)
	);
	const roles: RoleInfo[] = $derived(data.roles);

	const DELETE_PREVIOUS_MESSAGES_OPTIONS = [
		{ value: "0", label: "None", seconds: null },
		{ value: "1h", label: "Previous hour", seconds: 60 * 60 },
		{ value: "6h", label: "Previous 6 hours", seconds: 6 * 60 * 60 },
		{ value: "12h", label: "Previous 12 hours", seconds: 12 * 60 * 60 },
		{ value: "24h", label: "Previous 24 hours", seconds: 24 * 60 * 60 },
		{ value: "3d", label: "Previous 3 days", seconds: 3 * 24 * 60 * 60 },
		{ value: "7d", label: "Previous 7 days", seconds: 7 * 24 * 60 * 60 }
	] as const;

	function deleteDurationToSeconds(value: string): number | null {
		const option = DELETE_PREVIOUS_MESSAGES_OPTIONS.find(option => option.value === value);
		return option?.seconds ?? null;
	}

	function secondsToDeleteDuration(seconds: number | null | undefined): string {
		const option = DELETE_PREVIOUS_MESSAGES_OPTIONS.find(
			option => option.seconds === (seconds ?? null)
		);
		return option?.value ?? "0";
	}

	function getComparableDeleteSeconds(seconds: number | null | undefined): number | null {
		return deleteDurationToSeconds(secondsToDeleteDuration(seconds));
	}

	const channelOptions = $derived<SelectOption[]>([
		{ value: "", label: "None" },
		...channels.map(c => ({ value: c.id, label: `#${c.name}` }))
	]);

	const deleteDurationOptions: SelectOption[] = DELETE_PREVIOUS_MESSAGES_OPTIONS.map(o => ({
		value: o.value,
		label: o.label
	}));

	let enabled = $state(false);
	let channelId = $state("");
	let automaticallyTimeout = $state(false);
	let enforceSubmissionReason = $state(true);
	let enforceDenyReason = $state(true);
	let immuneRoles = $state<string[]>([]);
	let notifyRoles = $state<string[]>([]);
	let notifyTarget = $state(true);
	let disableReasonField = $state(false);
	let additionalInfo = $state("");
	let deletePreviousMessages = $state("0");

	$effect.pre(() => {
		const cfg = data.guild.config.ban_requests;
		enabled = cfg.enabled;
		channelId = cfg.webhook_channel ?? "";
		automaticallyTimeout = cfg.automatically_timeout;
		enforceSubmissionReason = cfg.enforce_submission_reason;
		enforceDenyReason = cfg.enforce_deny_reason;
		immuneRoles = [...cfg.immune_roles];
		notifyRoles = [...cfg.notify_roles];
		notifyTarget = cfg.notify_target;
		disableReasonField = cfg.disable_reason_field;
		additionalInfo = cfg.additional_info ?? "";
		deletePreviousMessages = secondsToDeleteDuration(cfg.delete_message_seconds);
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;

	function normalizeStringSet(values: string[]) {
		return [...values].sort((a, b) => a.localeCompare(b));
	}

	const isDirty = $derived(
		enabled !== config.enabled ||
			channelId !== (config.webhook_channel ?? "") ||
			automaticallyTimeout !== config.automatically_timeout ||
			enforceSubmissionReason !== config.enforce_submission_reason ||
			enforceDenyReason !== config.enforce_deny_reason ||
			JSON.stringify(normalizeStringSet(immuneRoles)) !==
				JSON.stringify(normalizeStringSet(config.immune_roles)) ||
			JSON.stringify(normalizeStringSet(notifyRoles)) !==
				JSON.stringify(normalizeStringSet(config.notify_roles)) ||
			notifyTarget !== config.notify_target ||
			disableReasonField !== config.disable_reason_field ||
			additionalInfo !== (config.additional_info ?? "") ||
			deleteDurationToSeconds(deletePreviousMessages) !==
				getComparableDeleteSeconds(config.delete_message_seconds)
	);

	function triggerShake() {
		shaking = true;
		if (shakeTimeout) clearTimeout(shakeTimeout);
		shakeTimeout = setTimeout(() => {
			shaking = false;
			shakeTimeout = undefined;
		}, 600);
	}

	function scheduleStatusReset(delayMs: number) {
		if (statusTimeout) clearTimeout(statusTimeout);
		statusTimeout = setTimeout(() => {
			saveStatus = "idle";
			statusTimeout = undefined;
		}, delayMs);
	}

	onDestroy(() => {
		if (shakeTimeout) clearTimeout(shakeTimeout);
		if (statusTimeout) clearTimeout(statusTimeout);
	});

	beforeNavigate(({ cancel }) => {
		if (!isDirty) return;
		cancel();
		triggerShake();
	});

	function resetForm() {
		enabled = config.enabled;
		channelId = config.webhook_channel ?? "";
		automaticallyTimeout = config.automatically_timeout;
		enforceSubmissionReason = config.enforce_submission_reason;
		enforceDenyReason = config.enforce_deny_reason;
		immuneRoles = [...config.immune_roles];
		notifyRoles = [...config.notify_roles];
		notifyTarget = config.notify_target;
		disableReasonField = config.disable_reason_field;
		additionalInfo = config.additional_info ?? "";
		deletePreviousMessages = secondsToDeleteDuration(config.delete_message_seconds);
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";
		try {
			const response = await fetch(`/api/servers/${data.guild.id}/configs/ban-requests`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					enabled,
					channelId: channelId || null,
					automaticallyTimeout,
					enforceSubmissionReason,
					enforceDenyReason,
					immuneRoles,
					notifyRoles,
					notifyTarget,
					disableReasonField,
					additionalInfo: additionalInfo.trim() ? additionalInfo : null,
					deleteMessageSeconds: deleteDurationToSeconds(deletePreviousMessages)
				})
			});
			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success)
				throw new Error(payload.error ?? "Failed to save ban requests config.");

			await invalidateAll();
			saveStatus = "success";
			scheduleStatusReset(2500);
		} catch (error) {
			saveStatus = "error";
			saveError = error instanceof Error ? error.message : "An unknown error occurred.";
			scheduleStatusReset(5000);
		}
	}
</script>

<div class="page-content space-y-8">
	<PageHeader
		title="Ban Requests"
		description="Configure moderation approval flow for ban actions."
		icon={Ban}
		{enabled}
		onToggle={() => (enabled = !enabled)}
	/>

	<form id="ban-requests-form" onsubmit={submitConfig} class="space-y-6">
		<!-- Review Channel -->
		<ConfigSection
			title="Review Channel"
			description="Select the channel where new ban request submissions will be sent. Rhenium will automatically create a webhook in this channel."
		>
			<Select bind:value={channelId} options={channelOptions} class="w-full max-w-sm" />
		</ConfigSection>

		<!-- Behavior Toggles -->
		<ConfigSection title="Behavior" description="Control how ban requests are processed.">
			<div class="space-y-6">
				<div>
					<label
						for="deletePreviousMessages"
						class="text-sm font-medium text-zinc-300"
						>Delete previous messages</label
					>
					<p class="mt-0.5 text-xs text-zinc-500">
						When the ban request is approved, delete messages sent by the target
						user in the specified time range.
					</p>
					<Select
						bind:value={deletePreviousMessages}
						options={deleteDurationOptions}
						class="mt-2 w-full max-w-xs"
					/>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-zinc-300">
							Time out automatically
						</p>
						<p class="text-xs text-zinc-500">
							Time out the target user for 28 days when a ban request is
							submitted.
						</p>
					</div>
					<Toggle
						checked={automaticallyTimeout}
						onToggle={() => (automaticallyTimeout = !automaticallyTimeout)}
						label="Toggle automatic timeout"
					/>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-zinc-300">
							Require a reason before submitting
						</p>
						<p class="text-xs text-zinc-500">
							Require users to provide a reason when submitting a ban request.
						</p>
					</div>
					<Toggle
						checked={enforceSubmissionReason}
						onToggle={() => (enforceSubmissionReason = !enforceSubmissionReason)}
						label="Toggle enforce submission reason"
					/>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-zinc-300">Require denial reason</p>
						<p class="text-xs text-zinc-500">
							Require moderators to provide a reason when denying a ban
							request.
						</p>
					</div>
					<Toggle
						checked={enforceDenyReason}
						onToggle={() => (enforceDenyReason = !enforceDenyReason)}
						label="Toggle enforce deny reason"
					/>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-zinc-300">Notify target user</p>
						<p class="text-xs text-zinc-500">
							Send a DM to the target user when they are banned via a request.
						</p>
					</div>
					<Toggle
						checked={notifyTarget}
						onToggle={() => (notifyTarget = !notifyTarget)}
						label="Toggle notify target user"
					/>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-zinc-300">Disable reason field</p>
						<p class="text-xs text-zinc-500">
							Hide the reason field in the embed sent to the target user.
						</p>
					</div>
					<Toggle
						checked={disableReasonField}
						onToggle={() => (disableReasonField = !disableReasonField)}
						label="Toggle disable reason field"
					/>
				</div>
			</div>
		</ConfigSection>

		<!-- Roles -->
		<ConfigSection
			title="Roles"
			description="Set role base immunity and notification preferences."
		>
			<div class="space-y-8">
				<RoleSelector
					bind:selected={immuneRoles}
					{roles}
					label="Immune Roles"
					placeholder="Add an immune role…"
				/>
				<RoleSelector
					bind:selected={notifyRoles}
					{roles}
					label="Notification Roles"
					placeholder="Add a notification role…"
					showHere
				/>
			</div>
		</ConfigSection>

		<!-- Message Settings -->
		<ConfigSection
			title="Message Settings"
			description="Configure the contents of the ban request notification message."
		>
			<div class="space-y-6">
				<div>
					<label for="additionalInfo" class="text-sm font-medium text-zinc-300"
						>Additional Info</label
					>
					<p class="mt-0.5 text-xs text-zinc-500">
						Extra information shown on the ban request embed. Supports basic
						markdown.
					</p>
					<textarea
						id="additionalInfo"
						bind:value={additionalInfo}
						rows={4}
						maxlength={1024}
						class="mt-2 w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none placeholder:text-zinc-600"
					></textarea>
					<p class="mt-1 text-xs text-zinc-600">
						{additionalInfo.length}/1024 characters
					</p>
				</div>
			</div>
		</ConfigSection>
	</form>
</div>

<UnsavedChangesBar
	visible={isDirty || saveStatus !== "idle"}
	{saveStatus}
	{saveError}
	{isDirty}
	{shaking}
	onReset={resetForm}
	formId="ban-requests-form"
/>

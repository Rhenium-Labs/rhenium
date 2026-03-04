<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { Ban } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import RoleSelector from "$lib/components/RoleSelector.svelte";
	import type { PageData } from "./$types";

	interface ChannelInfo {
		id: string;
		name: string;
		type: number;
	}

	interface RoleInfo {
		id: string;
		name: string;
		color: number;
		position: number;
		managed: boolean;
	}

	let { data }: { data: PageData } = $props();

	const config = $derived(data.guild.config.ban_requests);
	const channels: ChannelInfo[] = $derived(
		data.channels.filter((c: ChannelInfo) => c.type === 0 || c.type === 5)
	);
	const roles: RoleInfo[] = $derived(data.roles);

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
	let deleteMessageSeconds = $state(30);

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
		deleteMessageSeconds = cfg.delete_message_seconds ?? 30;
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;

	const isDirty = $derived(
		enabled !== config.enabled ||
			channelId !== (config.webhook_channel ?? "") ||
			automaticallyTimeout !== config.automatically_timeout ||
			enforceSubmissionReason !== config.enforce_submission_reason ||
			enforceDenyReason !== config.enforce_deny_reason ||
			JSON.stringify(immuneRoles) !== JSON.stringify(config.immune_roles) ||
			JSON.stringify(notifyRoles) !== JSON.stringify(config.notify_roles) ||
			notifyTarget !== config.notify_target ||
			disableReasonField !== config.disable_reason_field ||
			additionalInfo !== (config.additional_info ?? "") ||
			deleteMessageSeconds !== (config.delete_message_seconds ?? 30)
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
		deleteMessageSeconds = config.delete_message_seconds ?? 30;
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
					deleteMessageSeconds
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

<div class="space-y-8">
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
			description="Select the channel where new ban request submissions will be sent. The bot will automatically create a webhook in this channel."
		>
			<select
				bind:value={channelId}
				class="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
			>
				<option value="">No channel selected</option>
				{#each channels as channel}
					<option value={channel.id}>#{channel.name}</option>
				{/each}
			</select>
		</ConfigSection>

		<!-- Behavior Toggles -->
		<ConfigSection title="Behavior" description="Control how ban requests are processed.">
			<div class="space-y-6">
				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-zinc-300">Automatically Timeout</p>
						<p class="text-xs text-zinc-500">
							Timeout the user automatically when a ban request is approved.
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
							Enforce Submission Reason
						</p>
						<p class="text-xs text-zinc-500">
							Require a reason when submitting a ban request.
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
						<p class="text-sm font-medium text-zinc-300">Enforce Deny Reason</p>
						<p class="text-xs text-zinc-500">
							Require a reason when denying a ban request.
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
						<p class="text-sm font-medium text-zinc-300">Notify Target User</p>
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
						<p class="text-sm font-medium text-zinc-300">Disable Reason Field</p>
						<p class="text-xs text-zinc-500">
							Hide the reason field from the ban request submission form.
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
			description="Configure role-based immunities and notifications."
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
					label="Notify Roles"
					placeholder="Add a notify role…"
					showHere
				/>
			</div>
		</ConfigSection>

		<!-- Message Settings -->
		<ConfigSection title="Message Settings" description="Configure ban message behavior.">
			<div class="space-y-6">
				<div>
					<label for="deleteSeconds" class="text-sm font-medium text-zinc-300"
						>Delete Message Seconds</label
					>
					<p class="mt-0.5 text-xs text-zinc-500">
						Number of seconds of message history to delete when the user is
						banned.
					</p>
					<input
						id="deleteSeconds"
						type="number"
						min="1"
						max="86400"
						bind:value={deleteMessageSeconds}
						class="mt-2 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
					/>
				</div>

				<div>
					<label for="additionalInfo" class="text-sm font-medium text-zinc-300"
						>Additional Info</label
					>
					<p class="mt-0.5 text-xs text-zinc-500">
						Extra information shown on the ban request embed. Supports basic
						Markdown.
					</p>
					<textarea
						id="additionalInfo"
						bind:value={additionalInfo}
						rows={4}
						maxlength={2000}
						class="mt-2 w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
					></textarea>
					<p class="mt-1 text-xs text-zinc-600">
						{additionalInfo.length}/2000 characters
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

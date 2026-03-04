<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { Flag } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import RoleSelector from "$lib/components/RoleSelector.svelte";
	import type { PageData } from "./$types";

	/** Simplified channel representation from the bot. */
	interface ChannelInfo {
		id: string;
		name: string;
		type: number;
	}

	/** Simplified role representation from the bot. */
	interface RoleInfo {
		id: string;
		name: string;
		color: number;
		position: number;
		managed: boolean;
	}

	let { data }: { data: PageData } = $props();

	const config = $derived(data.guild.config.message_reports);
	const channels: ChannelInfo[] = $derived(
		data.channels.filter((ch: ChannelInfo) => ch.type === 0 || ch.type === 5)
	);
	const roles: RoleInfo[] = $derived(data.roles);

	let enabled = $state(false);
	let channelId = $state("");
	let autoDisregardAfter = $state("");
	let deleteOnHandle = $state(true);
	let placeholderReason = $state("");
	let enforceMember = $state(true);
	let enforceReason = $state(true);
	let immuneRoles = $state<string[]>([]);
	let notifyRoles = $state<string[]>([]);

	$effect.pre(() => {
		const cfg = data.guild.config.message_reports;
		enabled = cfg.enabled;
		channelId = cfg.webhook_channel ?? "";
		autoDisregardAfter = formatDuration(cfg.auto_disregard_after);
		deleteOnHandle = cfg.delete_submission_on_handle;
		placeholderReason = cfg.placeholder_reason ?? "";
		enforceMember = cfg.enforce_member_in_guild;
		enforceReason = cfg.enforce_report_reason;
		immuneRoles = [...cfg.immune_roles];
		notifyRoles = [...cfg.notify_roles];
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
			autoDisregardAfter !== formatDuration(config.auto_disregard_after) ||
			deleteOnHandle !== config.delete_submission_on_handle ||
			placeholderReason !== (config.placeholder_reason ?? "") ||
			enforceMember !== config.enforce_member_in_guild ||
			enforceReason !== config.enforce_report_reason ||
			JSON.stringify(normalizeStringSet(immuneRoles)) !==
				JSON.stringify(normalizeStringSet(config.immune_roles)) ||
			JSON.stringify(normalizeStringSet(notifyRoles)) !==
				JSON.stringify(normalizeStringSet(config.notify_roles))
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
		if (isDirty) {
			cancel();
			triggerShake();
		}
	});

	function resetForm() {
		const cfg = data.guild.config.message_reports;
		enabled = cfg.enabled;
		channelId = cfg.webhook_channel ?? "";
		autoDisregardAfter = formatDuration(cfg.auto_disregard_after);
		deleteOnHandle = cfg.delete_submission_on_handle;
		placeholderReason = cfg.placeholder_reason ?? "";
		enforceMember = cfg.enforce_member_in_guild;
		enforceReason = cfg.enforce_report_reason;
		immuneRoles = [...cfg.immune_roles];
		notifyRoles = [...cfg.notify_roles];
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";

		try {
			const response = await fetch(
				`/api/servers/${data.guild.id}/configs/message-reports`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						enabled,
						channelId: channelId || null,
						autoDisregardAfter,
						deleteOnHandle,
						placeholderReason,
						enforceMember,
						enforceReason,
						immuneRoles,
						notifyRoles
					})
				}
			);

			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success) {
				throw new Error(payload.error ?? "Failed to save configuration.");
			}

			await invalidateAll();
			saveStatus = "success";
			scheduleStatusReset(2500);
		} catch (error) {
			saveStatus = "error";
			saveError = error instanceof Error ? error.message : "An unknown error occurred.";
			scheduleStatusReset(5000);
		}
	}

	// ── Duration helpers ────────────────────────────────────────────────
	function formatDuration(ms: string): string {
		const val = BigInt(ms);
		if (val === 0n) return "";
		if (val % 604_800_000n === 0n) return `${val / 604_800_000n}w`;
		if (val % 86_400_000n === 0n) return `${val / 86_400_000n}d`;
		if (val % 3_600_000n === 0n) return `${val / 3_600_000n}h`;
		if (val % 60_000n === 0n) return `${val / 60_000n}m`;
		return ms;
	}
</script>

<div class="space-y-8">
	<PageHeader
		title="Message Reports"
		description="Let users alert your moderator team to problematic messages."
		icon={Flag}
		{enabled}
		onToggle={() => (enabled = !enabled)}
	/>

	<form id="config-form" method="POST" onsubmit={submitConfig}>
		<input type="hidden" name="enabled" value={enabled.toString()} />
		<input type="hidden" name="channelId" value={channelId} />
		<input type="hidden" name="deleteOnHandle" value={deleteOnHandle.toString()} />
		<input type="hidden" name="enforceMember" value={enforceMember.toString()} />
		<input type="hidden" name="enforceReason" value={enforceReason.toString()} />
		<input type="hidden" name="immuneRoles" value={JSON.stringify(immuneRoles)} />
		<input type="hidden" name="notifyRoles" value={JSON.stringify(notifyRoles)} />

		<div class="space-y-6">
			<!-- Review Channel -->
			<ConfigSection
				title="Review Channel"
				description="Select the channel where new message reports will be sent. The bot will automatically create a webhook in this channel."
			>
				<select
					bind:value={channelId}
					class="w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
				>
					<option value="">Disabled</option>
					{#each channels as ch (ch.id)}
						<option value={ch.id}>#{ch.name}</option>
					{/each}
				</select>
			</ConfigSection>

			<!-- Behavior -->
			<ConfigSection
				title="Behavior"
				description="Control how reports are handled after submission."
			>
				<div class="space-y-6">
					<div>
						<label for="autoDisregard" class="text-sm font-medium text-zinc-300"
							>Auto-Disregard After</label
						>
						<p class="mt-0.5 text-xs text-zinc-500">
							Pending reports are automatically disregarded after this
							duration. Leave empty to disable.
						</p>
						<input
							id="autoDisregard"
							name="autoDisregardAfter"
							type="text"
							bind:value={autoDisregardAfter}
							placeholder="e.g. 3d, 12h, 1w"
							class="mt-2 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						/>
						<p class="mt-1 text-xs text-zinc-600">
							Supported: m (minutes), h (hours), d (days), w (weeks)
						</p>
					</div>

					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-medium text-zinc-300">
								Delete submission once handled
							</p>
							<p class="text-xs text-zinc-500">
								Delete the submission message once it has been resolved or
								disregarded.
							</p>
						</div>
						<Toggle
							checked={deleteOnHandle}
							onToggle={() => (deleteOnHandle = !deleteOnHandle)}
							label="Toggle delete submission on handle"
						/>
					</div>

					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-medium text-zinc-300">
								Require the message author to be a member of the server
							</p>
							<p class="text-xs text-zinc-500">
								Restrict report submissions to only messages sent by users
								who are currently in the server.
							</p>
						</div>
						<Toggle
							checked={enforceMember}
							onToggle={() => (enforceMember = !enforceMember)}
							label="Toggle enforce member requirement."
						/>
					</div>

					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-medium text-zinc-300">
								Require a reason before submitting
							</p>
							<p class="text-xs text-zinc-500">
								Require reporters to provide a reason when submitting a
								report.
							</p>
						</div>
						<Toggle
							checked={enforceReason}
							onToggle={() => (enforceReason = !enforceReason)}
							label="Toggle enforce reason requirement."
						/>
					</div>

					<div>
						<label
							for="placeholderReason"
							class="text-sm font-medium text-zinc-300">Default reason</label
						>
						<p class="mt-0.5 text-xs text-zinc-500">
							The default reason provided when a report is submitted without a
							reason.
						</p>
						<textarea
							id="placeholderReason"
							name="placeholderReason"
							bind:value={placeholderReason}
							maxlength={1024}
							rows={4}
							placeholder="No reason provided."
							class="mt-2 w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						></textarea>
						<p class="mt-1 text-xs text-zinc-600">
							{placeholderReason.length}/1024 characters
						</p>
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
		</div>
	</form>
</div>

<UnsavedChangesBar
	visible={isDirty || saveStatus !== "idle"}
	{saveStatus}
	{saveError}
	{isDirty}
	{shaking}
	onReset={resetForm}
	formId="config-form"
/>

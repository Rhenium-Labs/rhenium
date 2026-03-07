<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { ChannelScopingType, LoggingEvent } from "@repo/config";
	import { VolumeOff } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import ChannelScopeList from "$lib/components/ChannelScopeList.svelte";
	import type { PageData } from "./$types";
	import type { ChannelInfo } from "@repo/trpc";

	let { data }: { data: PageData } = $props();

	const config = $derived(data.guild.config.quick_mutes);
	const hasRequiredLoggingEvents = $derived(
		data.guild.config.logging_webhooks.some(webhook =>
			webhook.events.some(
				eventName =>
					eventName === LoggingEvent.QuickMuteResult ||
					eventName === LoggingEvent.QuickMuteExecuted
			)
		)
	);
	const scopingChannels: ChannelInfo[] = $derived.by(() => {
		const scoped = data.channels.filter(
			(channel: ChannelInfo) =>
				channel.type === 0 || channel.type === 4 || channel.type === 5
		);

		const scopedById = new Map(scoped.map(channel => [channel.id, channel]));
		const topLevel = scoped
			.filter(channel => channel.parentId === null || !scopedById.has(channel.parentId))
			.sort((a, b) => a.position - b.position);

		const ordered: ChannelInfo[] = [];
		for (const channel of topLevel) {
			ordered.push(channel);
			if (channel.type === 4) {
				const children = scoped
					.filter(
						candidate =>
							(candidate.type === 0 || candidate.type === 5) &&
							candidate.parentId === channel.id
					)
					.sort((a, b) => a.position - b.position);
				ordered.push(...children);
			}
		}

		return ordered;
	});

	let enabled = $state(false);
	let purgeLimit = $state(100);
	let channelScoping = $state<{ uiId: string; channelId: string; type: ChannelScopingType }[]>(
		[]
	);

	$effect.pre(() => {
		const cfg = data.guild.config.quick_mutes;
		enabled = cfg.enabled;
		purgeLimit = cfg.purge_limit;
		channelScoping = cfg.channel_scoping.map(scope => ({
			uiId: scope.channel_id,
			channelId: scope.channel_id,
			type: scope.type
		}));
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;

	function normalizeChannelScoping(rows: { channelId: string; type: ChannelScopingType }[]) {
		return rows.map(({ channelId, type }) => ({ channelId, type }));
	}

	const isDirty = $derived(
		enabled !== config.enabled ||
			purgeLimit !== config.purge_limit ||
			JSON.stringify(normalizeChannelScoping(channelScoping)) !==
				JSON.stringify(
					config.channel_scoping.map(scope => ({
						channelId: scope.channel_id,
						type: scope.type
					}))
				)
	);

	function resetForm() {
		enabled = config.enabled;
		purgeLimit = config.purge_limit;
		channelScoping = config.channel_scoping.map(scope => ({
			uiId: scope.channel_id,
			channelId: scope.channel_id,
			type: scope.type
		}));
	}

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

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";

		try {
			const response = await fetch(`/api/servers/${data.guild.id}/configs/quick-mutes`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					enabled,
					purgeLimit,
					channelScoping: normalizeChannelScoping(channelScoping)
				})
			});
			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success)
				throw new Error(payload.error ?? "Failed to save quick mutes config.");

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
		title="Quick Mutes"
		description="Configure reaction-based mute behavior and scoping."
		icon={VolumeOff}
		{enabled}
		onToggle={() => (enabled = !enabled)}
	/>

	<form id="quick-mutes-form" onsubmit={submitConfig} class="space-y-6">
		{#if !hasRequiredLoggingEvents}
			<div class="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3">
				<p class=" text-sm text-red-300">
					For quick mutes to work, a
					<a
						href={`/servers/${data.guild.id}/logging`}
						class="font-medium underline underline-offset-2 hover:text-red-200"
					>
						logging
					</a>
					channel must be configured to receive the
					<span class="font-medium">QuickMuteResult</span> and
					<span class="font-medium">QuickMuteExecuted</span> events.
				</p>
			</div>
		{/if}

		<ConfigSection
			title="Purge Limit"
			description="Number of messages to purge when muting a user."
		>
			<label for="purgeLimit" class="text-sm font-medium text-zinc-300"
				>Messages to purge</label
			>
			<p class="mt-0.5 text-xs text-zinc-500">Allowed range: 2 to 500 messages.</p>
			<input
				id="purgeLimit"
				type="number"
				min="2"
				max="500"
				bind:value={purgeLimit}
				class="mt-2 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none"
			/>
		</ConfigSection>

		<ConfigSection title="Channel Scoping" description="Limit where quick mutes can be used.">
			<ChannelScopeList bind:scoping={channelScoping} channels={scopingChannels} />
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
	formId="quick-mutes-form"
/>

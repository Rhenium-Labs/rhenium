<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { ChannelScopingType, LoggingEvent } from "@repo/config";
	import { Trash2, TriangleAlert } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import ChannelScopeList from "$lib/components/ChannelScopeList.svelte";
	import type { PageData } from "./$types";
	import type { ChannelInfo } from "@repo/trpc";

	let { data }: { data: PageData } = $props();

	const config = $derived(data.guild.config.quick_purges);
	const hasRequiredLoggingEvents = $derived(
		data.guild.config.logging_webhooks.some(webhook =>
			webhook.events.some(
				eventName =>
					eventName === LoggingEvent.QuickPurgeResult ||
					eventName === LoggingEvent.QuickPurgeExecuted
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
	let maxLimit = $state(100);
	let channelScoping = $state<{ uiId: string; channelId: string; type: ChannelScopingType }[]>(
		[]
	);

	$effect.pre(() => {
		const cfg = data.guild.config.quick_purges;
		enabled = cfg.enabled;
		maxLimit = cfg.max_limit;
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
			maxLimit !== config.max_limit ||
			JSON.stringify(normalizeChannelScoping(channelScoping)) !==
				JSON.stringify(
					config.channel_scoping.map(scope => ({
						channelId: scope.channel_id,
						type: scope.type
					}))
				)
	);

	$effect(() => {
		// removed: measure effect for reservedEmptyHeight
	});

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
		maxLimit = config.max_limit;
		channelScoping = config.channel_scoping.map(scope => ({
			uiId: scope.channel_id,
			channelId: scope.channel_id,
			type: scope.type
		}));
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";

		try {
			const response = await fetch(`/api/servers/${data.guild.id}/configs/quick-purges`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					enabled,
					maxLimit,
					channelScoping: normalizeChannelScoping(channelScoping)
				})
			});
			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success)
				throw new Error(payload.error ?? "Failed to save quick purges config.");

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
		title="Quick Purges"
		description="Configure reaction-based bulk message deletion behavior."
		icon={Trash2}
		{enabled}
		onToggle={() => (enabled = !enabled)}
	/>

	<form id="quick-purges-form" onsubmit={submitConfig} class="space-y-6">
		{#if !hasRequiredLoggingEvents}
			<div class="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3">
				<p class=" text-sm text-red-300">
					For quick purges to work, a
					<a
						href={`/servers/${data.guild.id}/logging`}
						class="font-medium underline underline-offset-2 hover:text-red-200"
					>
						logging
					</a>
					channel must be configured to receive the
					<span class="font-medium">QuickPurgeResult</span> and
					<span class="font-medium">QuickPurgeExecuted</span> events.
				</p>
			</div>
		{/if}

		<ConfigSection
			title="Purge Limit"
			description="Maximum number of messages that can be purged at once."
		>
			<label for="maxLimit" class="text-sm font-medium text-zinc-300"
				>Maximum Purge Limit</label
			>
			<p class="mt-0.5 text-xs text-zinc-500">Allowed range: 2 to 500 messages.</p>
			<input
				id="maxLimit"
				type="number"
				min="2"
				max="500"
				bind:value={maxLimit}
				class="mt-2 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none"
			/>
		</ConfigSection>

		<ConfigSection
			title="Channel Scoping"
			description="Limit where quick purges can be used."
		>
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
	formId="quick-purges-form"
/>

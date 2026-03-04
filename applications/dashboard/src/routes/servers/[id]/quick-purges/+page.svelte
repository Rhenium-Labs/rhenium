<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { flip } from "svelte/animate";
	import { cubicOut } from "svelte/easing";
	import { fade, slide } from "svelte/transition";
	import { ChannelScopingType, LoggingEvent } from "@repo/config";
	import { TriangleAlert, Trash2, Plus } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import type { PageData } from "./$types";

	interface ChannelInfo {
		id: string;
		name: string;
		type: number;
	}

	type ScopeRow = {
		uiId: string;
		channelId: string;
		type: ChannelScopingType;
	};

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
	const channels: ChannelInfo[] = $derived(
		data.channels.filter((c: ChannelInfo) => c.type === 0 || c.type === 5)
	);

	let enabled = $state(false);
	let maxLimit = $state(100);
	let channelScoping = $state<ScopeRow[]>([]);
	let nextScopeUiId = 0;
	let scopeRowMeasureEl: HTMLDivElement | undefined;
	let reservedEmptyHeight = $state(0);

	function createScopeRow(channelId: string, type: ChannelScopingType): ScopeRow {
		return {
			uiId: `scope-${nextScopeUiId++}`,
			channelId,
			type
		};
	}

	$effect.pre(() => {
		const cfg = data.guild.config.quick_purges;
		enabled = cfg.enabled;
		maxLimit = cfg.max_limit;
		channelScoping = cfg.channel_scoping.map(scope =>
			createScopeRow(scope.channel_id, scope.type)
		);
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;

	function normalizeChannelScoping(rows: ScopeRow[]) {
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
		if (!scopeRowMeasureEl) return;
		const measuredHeight = Math.ceil(scopeRowMeasureEl.getBoundingClientRect().height);
		if (measuredHeight > 0 && measuredHeight !== reservedEmptyHeight) {
			reservedEmptyHeight = measuredHeight;
		}
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
		channelScoping = config.channel_scoping.map(scope =>
			createScopeRow(scope.channel_id, scope.type)
		);
	}

	function addScope() {
		const fallbackChannel = channels[0]?.id;
		if (!fallbackChannel) return;
		channelScoping = [
			...channelScoping,
			createScopeRow(fallbackChannel, ChannelScopingType.Include)
		];
	}

	function removeScope(scopeUiId: string) {
		channelScoping = channelScoping.filter(scope => scope.uiId !== scopeUiId);
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

<div class="space-y-8">
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
				class="mt-2 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
			/>
		</ConfigSection>

		<ConfigSection
			title="Channel Scoping"
			description="Limit where quick purges can be used."
		>
			<div class="mb-4 flex justify-end">
				<button
					type="button"
					onclick={addScope}
					class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
				>
					<Plus class="h-3.5 w-3.5" strokeWidth={2} />
					Add scope
				</button>
			</div>

			<div
				class="relative space-y-3"
				style:min-height={channelScoping.length === 0 && reservedEmptyHeight > 0
					? `${reservedEmptyHeight}px`
					: undefined}
			>
				{#if channelScoping.length === 0}
					<p
						class="absolute inset-0 flex items-center justify-center text-sm text-zinc-600"
					>
						No channel scoping rules configured.
					</p>
				{/if}
				{#each channelScoping as scope (scope.uiId)}
					<div
						animate:flip={{ duration: 170, easing: cubicOut }}
						in:fade={{ duration: 120 }}
						out:slide={{ duration: 140, easing: cubicOut }}
						class="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 md:grid-cols-[1fr_auto_auto]"
					>
						<select
							bind:value={scope.channelId}
							class="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						>
							{#each channels as channel}
								<option value={channel.id}>#{channel.name}</option>
							{/each}
						</select>
						<select
							bind:value={scope.type}
							class="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						>
							<option value={ChannelScopingType.Include}>Include</option>
							<option value={ChannelScopingType.Exclude}>Exclude</option>
						</select>
						<button
							type="button"
							onclick={() => removeScope(scope.uiId)}
							class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/40"
						>
							<Trash2 class="h-3.5 w-3.5" strokeWidth={2} />
							Remove
						</button>
					</div>
				{/each}

				<div
					bind:this={scopeRowMeasureEl}
					aria-hidden="true"
					class="pointer-events-none invisible absolute inset-x-0 top-0 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 md:grid-cols-[1fr_auto_auto]"
				>
					<div
						class="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
					>
						#placeholder-channel
					</div>
					<div
						class="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
					>
						Include
					</div>
					<button
						type="button"
						class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400"
					>
						<Trash2 class="h-3.5 w-3.5" strokeWidth={2} />
						Remove
					</button>
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
	formId="quick-purges-form"
/>

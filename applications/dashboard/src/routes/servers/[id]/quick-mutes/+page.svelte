<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { flip } from "svelte/animate";
	import { cubicOut } from "svelte/easing";
	import { fade, slide } from "svelte/transition";
	import { ChannelScopingType, LoggingEvent } from "@repo/config";
	import { VolumeOff, Plus, Trash2, Folder, ChevronDown } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import type { PageData } from "./$types";

	interface ChannelInfo {
		id: string;
		name: string;
		type: number;
		parentId: string | null;
		position: number;
	}

	type ScopeRow = {
		uiId: string;
		channelId: string;
		type: ChannelScopingType;
	};

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
	let channelScoping = $state<ScopeRow[]>([]);
	let openScopeMenuUiId = $state<string | null>(null);
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
		const cfg = data.guild.config.quick_mutes;
		enabled = cfg.enabled;
		purgeLimit = cfg.purge_limit;
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
			purgeLimit !== config.purge_limit ||
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
		purgeLimit = config.purge_limit;
		channelScoping = config.channel_scoping.map(scope =>
			createScopeRow(scope.channel_id, scope.type)
		);
	}

	function addScope() {
		const fallbackChannel = scopingChannels[0]?.id;
		if (!fallbackChannel) return;
		channelScoping = [
			...channelScoping,
			createScopeRow(fallbackChannel, ChannelScopingType.Include)
		];
	}

	function getScopeChannelById(channelId: string): ChannelInfo | undefined {
		return scopingChannels.find(channel => channel.id === channelId);
	}

	function setScopeChannel(scopeUiId: string, channelId: string) {
		channelScoping = channelScoping.map(scope =>
			scope.uiId === scopeUiId ? { ...scope, channelId } : scope
		);
		openScopeMenuUiId = null;
	}

	function isCategoryChannel(channel: ChannelInfo | undefined): boolean {
		return channel?.type === 4;
	}

	function getScopeChannelName(channel: ChannelInfo | undefined): string {
		if (!channel) return "Unknown channel";
		return channel.name;
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

<div class="space-y-8">
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
				class="mt-2 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
			/>
		</ConfigSection>

		<ConfigSection title="Channel Scoping" description="Limit where quick mutes can be used.">
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
					{@const selectedChannel = getScopeChannelById(scope.channelId)}
					<div
						animate:flip={{ duration: 170, easing: cubicOut }}
						in:fade={{ duration: 120 }}
						out:slide={{ duration: 140, easing: cubicOut }}
						class="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 md:grid-cols-[1fr_auto_auto]"
					>
						<div class="relative">
							<button
								type="button"
								onclick={() =>
									(openScopeMenuUiId =
										openScopeMenuUiId === scope.uiId
											? null
											: scope.uiId)}
								class="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none hover:border-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
							>
								<span class="flex min-w-0 items-center gap-2">
									{#if isCategoryChannel(selectedChannel)}
										<Folder
											class="h-4 w-4 shrink-0 text-white"
											fill="currentColor"
											strokeWidth={2.25}
										/>
									{:else}
										<span class="shrink-0 text-zinc-400">#</span>
									{/if}
									<span class="truncate"
										>{getScopeChannelName(selectedChannel)}</span
									>
								</span>
								<ChevronDown class="h-4 w-4 shrink-0 text-zinc-400" />
							</button>

							{#if openScopeMenuUiId === scope.uiId}
								<div
									class="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 p-1 shadow-2xl"
								>
									{#each scopingChannels as channel}
										<button
											type="button"
											onclick={() =>
												setScopeChannel(scope.uiId, channel.id)}
											class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-white transition-colors hover:bg-zinc-700"
										>
											{#if channel.type === 4}
												<Folder
													class="h-4 w-4 shrink-0 text-white"
													fill="currentColor"
													strokeWidth={2.25}
												/>
											{:else}
												<span class="shrink-0 text-zinc-400"
													>#</span
												>
											{/if}
											<span class="truncate">{channel.name}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
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
	formId="quick-mutes-form"
/>

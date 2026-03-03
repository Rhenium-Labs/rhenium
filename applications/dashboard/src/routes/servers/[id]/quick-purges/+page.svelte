<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { ChannelScopingType } from "@repo/config";
	import { Trash2, Plus } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import type { PageData } from "./$types";

	interface ChannelInfo {
		id: string;
		name: string;
		type: number;
	}

	let { data }: { data: PageData } = $props();

	const config = $derived(data.guild.config.quick_purges);
	const channels: ChannelInfo[] = $derived(
		data.channels.filter((c: ChannelInfo) => c.type === 0 || c.type === 5)
	);

	let enabled = $state(false);
	let maxLimit = $state(100);
	let channelScoping = $state<Array<{ channelId: string; type: ChannelScopingType }>>([]);

	$effect.pre(() => {
		const cfg = data.guild.config.quick_purges;
		enabled = cfg.enabled;
		maxLimit = cfg.max_limit;
		channelScoping = cfg.channel_scoping.map(scope => ({
			channelId: scope.channel_id,
			type: scope.type
		}));
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);

	const isDirty = $derived(
		enabled !== config.enabled ||
			maxLimit !== config.max_limit ||
			JSON.stringify(channelScoping) !==
				JSON.stringify(
					config.channel_scoping.map(scope => ({
						channelId: scope.channel_id,
						type: scope.type
					}))
				)
	);

	beforeNavigate(({ cancel }) => {
		if (!isDirty) return;
		cancel();
		shaking = true;
		setTimeout(() => (shaking = false), 600);
	});

	function resetForm() {
		enabled = config.enabled;
		maxLimit = config.max_limit;
		channelScoping = config.channel_scoping.map(scope => ({
			channelId: scope.channel_id,
			type: scope.type
		}));
	}

	function addScope() {
		const fallbackChannel = channels[0]?.id;
		if (!fallbackChannel) return;
		channelScoping = [
			...channelScoping,
			{ channelId: fallbackChannel, type: ChannelScopingType.Include }
		];
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
				body: JSON.stringify({ enabled, maxLimit, channelScoping })
			});
			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success)
				throw new Error(payload.error ?? "Failed to save quick purges config.");

			await invalidateAll();
			saveStatus = "success";
			setTimeout(() => (saveStatus = "idle"), 2500);
		} catch (error) {
			saveStatus = "error";
			saveError = error instanceof Error ? error.message : "An unknown error occurred.";
			setTimeout(() => (saveStatus = "idle"), 5000);
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

			<div class="space-y-3">
				{#if channelScoping.length === 0}
					<p class="py-4 text-center text-sm text-zinc-600">
						No channel scoping rules configured.
					</p>
				{/if}
				{#each channelScoping as scope, index}
					<div
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
							onclick={() =>
								(channelScoping = channelScoping.filter(
									(_, i) => i !== index
								))}
							class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/40"
						>
							<Trash2 class="h-3.5 w-3.5" strokeWidth={2} />
							Remove
						</button>
					</div>
				{/each}
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

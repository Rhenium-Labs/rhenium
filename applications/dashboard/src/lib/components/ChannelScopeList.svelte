<script lang="ts">
	import { ChannelScopingType } from "@repo/config";
	import { Trash2 } from "@lucide/svelte";
	import type { ChannelInfo } from "@repo/trpc";
	import Select from "./Select.svelte";
	import type { SelectOption } from "./Select.svelte";

	type ScopeRow = {
		uiId: string;
		channelId: string;
		type: ChannelScopingType;
	};

	let {
		scoping = $bindable([]),
		channels
	}: {
		scoping: ScopeRow[];
		channels: ChannelInfo[];
	} = $props();

	const typeOptions: SelectOption[] = [
		{ value: ChannelScopingType.Include as unknown as string, label: "Include" },
		{ value: ChannelScopingType.Exclude as unknown as string, label: "Exclude" }
	];

	let removing = $state(new Set<string>()); // uiIds
	let newItems = $state(new Set<string>()); // uiIds (animation)
	let pendingNew = $state(new Set<string>()); // uiIds of unsaved new scopes

	const availableChannels = $derived(
		channels.filter(
			c => (c.type === 0 || c.type === 5) && !scoping.some(s => s.channelId === c.id)
		)
	);

	function getChannelName(channelId: string): string {
		return channels.find(c => c.id === channelId)?.name ?? channelId;
	}

	function channelOptionsFor(uiId: string): SelectOption[] {
		const current = scoping.find(s => s.uiId === uiId)?.channelId;
		return channels
			.filter(
				c =>
					(c.type === 0 || c.type === 5) &&
					(c.id === current ||
						!scoping.some(s => s.uiId !== uiId && s.channelId === c.id))
			)
			.map(c => ({ value: c.id, label: `#${c.name}` }));
	}

	function addScope() {
		const first = availableChannels[0];
		if (!first) return;
		const uiId = crypto.randomUUID();
		const channelId = first.id;
		pendingNew = new Set([...pendingNew, uiId]);
		newItems = new Set([...newItems, uiId]);
		scoping = [...scoping, { uiId, channelId, type: ChannelScopingType.Include }];
		setTimeout(() => {
			newItems = new Set([...newItems].filter(id => id !== uiId));
		}, 350);
	}

	function removeScope(uiId: string) {
		removing = new Set([...removing, uiId]);
		setTimeout(() => {
			scoping = scoping.filter(s => s.uiId !== uiId);
			removing = new Set([...removing].filter(id => id !== uiId));
			pendingNew = new Set([...pendingNew].filter(id => id !== uiId));
		}, 220);
	}

	function setType(uiId: string, typeVal: string) {
		scoping = scoping.map(s =>
			s.uiId === uiId ? { ...s, type: typeVal as unknown as ChannelScopingType } : s
		);
	}

	function setChannel(uiId: string, channelId: string) {
		scoping = scoping.map(s => (s.uiId === uiId ? { ...s, channelId } : s));
	}
</script>

<div class="space-y-2">
	{#each scoping as scope (scope.uiId)}
		<div
			style="display: grid; grid-template-rows: {removing.has(scope.uiId)
				? '0fr'
				: '1fr'}; transition: grid-template-rows 220ms ease, opacity 220ms ease; opacity: {removing.has(
				scope.uiId
			)
				? '0'
				: '1'};"
		>
			<div class="min-h-0" class:overflow-hidden={removing.has(scope.uiId)}>
				<div
					class="mb-2 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 md:grid-cols-[1fr_auto_auto] {newItems.has(
						scope.uiId
					)
						? 'item-enter'
						: ''}"
				>
					{#if pendingNew.has(scope.uiId)}
						<Select
							value={scope.channelId}
							options={channelOptionsFor(scope.uiId)}
							onchange={v => setChannel(scope.uiId, v)}
						/>
					{:else}
						<div
							class="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300 select-none"
						>
							<span class="shrink-0 text-zinc-500">#</span>
							<span class="truncate">{getChannelName(scope.channelId)}</span>
						</div>
					{/if}
					<Select
						value={scope.type as unknown as string}
						options={typeOptions}
						onchange={v => setType(scope.uiId, v)}
					/>
					<button
						type="button"
						onclick={() => removeScope(scope.uiId)}
						class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/40"
					>
						<Trash2 class="h-3.5 w-3.5" strokeWidth={2} />
						Remove
					</button>
				</div>
			</div>
		</div>
	{/each}

	<div
		style="display: grid; grid-template-rows: {scoping.length === 0 ||
		(scoping.length > 0 && scoping.every(s => removing.has(s.uiId)))
			? '1fr'
			: '0fr'}; overflow: hidden; transition: grid-template-rows 220ms ease;"
	>
		<div class="min-h-0">
			<div
				class="mb-2 grid gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/20 p-3 md:grid-cols-[1fr_auto_auto]"
			>
				<div
					class="flex items-center gap-2 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2 text-sm text-zinc-600 select-none"
				>
					No channel scoping rules configured.
				</div>
			</div>
		</div>
	</div>

	<button
		type="button"
		onclick={addScope}
		disabled={availableChannels.length === 0}
		class="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
	>
		+ Add scope
	</button>
</div>

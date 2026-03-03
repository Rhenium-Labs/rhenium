<script lang="ts">
	import type { Component, SvelteComponent } from "svelte";
	import Toggle from "./Toggle.svelte";

	let {
		title,
		description,
		icon: Icon,
		enabled = undefined,
		onToggle = undefined
	}: {
		title: string;
		description: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon?: any;
		enabled?: boolean;
		onToggle?: () => void;
	} = $props();
</script>

<div class="flex items-start justify-between gap-4">
	<div class="flex items-start gap-3">
		{#if Icon}
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10"
			>
				<Icon class="h-5 w-5 text-indigo-400" strokeWidth={1.75} />
			</div>
		{/if}
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-white">{title}</h1>
			<p class="mt-1 text-sm text-zinc-400">{description}</p>
		</div>
	</div>
	{#if enabled !== undefined && onToggle}
		<Toggle checked={enabled} {onToggle} size="lg" label="Toggle {title}" />
	{/if}
</div>

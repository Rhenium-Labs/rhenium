<script lang="ts">
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

<header class="flex items-start justify-between gap-4">
	<div class="flex items-start gap-3">
		{#if Icon}
			<div
				class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900"
			>
				<Icon class="h-4 w-4 text-zinc-300" strokeWidth={1.8} />
			</div>
		{/if}
		<div class="min-w-0">
			<h1 class="text-base leading-tight font-semibold text-zinc-50">{title}</h1>
			{#if description}
				<p class="mt-0.5 text-xs leading-relaxed text-zinc-400">{description}</p>
			{/if}
		</div>
	</div>
	{#if enabled !== undefined && onToggle}
		<div class="mt-0.5 shrink-0">
			<Toggle checked={enabled} {onToggle} size="lg" label="Toggle {title}" />
		</div>
	{/if}
</header>

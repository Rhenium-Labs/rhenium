<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title = "",
		description = "",
		children
	}: {
		title?: string;
		description?: string;
		children: Snippet;
	} = $props();
</script>

<section class="rounded-xl border border-zinc-800/70 bg-zinc-900/25">
	{#if title || description}
		<header class="border-b border-zinc-800/70 px-5 py-4">
			{#if title}
				<h2 class="text-sm font-semibold text-zinc-100">{title}</h2>
			{/if}
			{#if description}
				<p class="mt-0.5 text-xs leading-relaxed text-zinc-400">{description}</p>
			{/if}
		</header>
	{/if}
	<div class="p-5">
		{@render children()}
	</div>
</section>

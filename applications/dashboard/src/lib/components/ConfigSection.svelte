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

<section class="config-card rounded-xl border border-zinc-800 bg-zinc-900/80 p-6">
	{#if title}
		<h2 class="text-base font-semibold text-white">{title}</h2>
	{/if}
	{#if description}
		<p class="mt-1 text-sm text-zinc-500">{description}</p>
	{/if}
	<div class={title || description ? "mt-5" : ""}>
		{@render children()}
	</div>
</section>

<style>
	.config-card {
		backdrop-filter: blur(8px);
	}
</style>

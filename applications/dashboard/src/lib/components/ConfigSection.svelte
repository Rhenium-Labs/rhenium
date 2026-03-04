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

<section class="config-card">
	{#if title || description}
		<header class="config-head">
			{#if title}
				<h2 class="config-title">{title}</h2>
			{/if}
			{#if description}
				<p class="config-description">{description}</p>
			{/if}
		</header>
	{/if}
	<div class={title || description ? "config-content has-head" : "config-content"}>
		{@render children()}
	</div>
</section>

<style>
	.config-card {
		padding: 0;
	}

	.config-head {
		padding: 0 0 0.7rem;
		border-bottom: 1px solid rgb(39 39 42 / 0.55);
	}

	.config-title {
		font-size: 1.05rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: rgb(244 244 245);
		line-height: 1.2;
	}

	.config-description {
		margin-top: 0.3rem;
		font-size: 0.82rem;
		line-height: 1.35;
		color: rgb(161 161 170);
	}

	.config-content {
		padding: 0.75rem 0 0;
	}

	.config-content.has-head {
		padding-top: 0.75rem;
	}
</style>

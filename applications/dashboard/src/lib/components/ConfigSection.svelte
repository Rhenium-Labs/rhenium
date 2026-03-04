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
		border: 1px solid rgb(39 39 42 / 0.9);
		border-radius: 1rem;
		background: linear-gradient(180deg, rgb(24 24 27 / 0.82) 0%, rgb(24 24 27 / 0.62) 100%);
		overflow: hidden;
		backdrop-filter: blur(12px);
		transition:
			border-color 180ms ease,
			background-color 180ms ease,
			transform 180ms ease;
	}

	.config-head {
		padding: 1rem 1.2rem;
		border-bottom: 1px solid rgb(39 39 42 / 0.8);
		background: rgb(9 9 11 / 0.35);
	}

	.config-title {
		font-size: 0.98rem;
		font-weight: 620;
		color: rgb(244 244 245);
		line-height: 1.25;
	}

	.config-description {
		margin-top: 0.4rem;
		font-size: 0.84rem;
		line-height: 1.45;
		color: rgb(161 161 170);
	}

	.config-content {
		padding: 1.25rem;
	}

	.config-content.has-head {
		padding-top: 1.1rem;
	}

	.config-card:hover {
		border-color: rgb(82 82 91 / 0.9);
		background-color: rgb(24 24 27 / 0.88);
	}
</style>

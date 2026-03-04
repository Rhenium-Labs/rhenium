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

<header class="hero-shell">
	<div class="hero-main">
		{#if Icon}
			<div class="hero-icon-wrap">
				<Icon class="h-5 w-5 text-zinc-100" strokeWidth={1.9} />
			</div>
		{/if}
		<div>
			<p class="hero-kicker">Module Configuration</p>
			<h1 class="hero-title">{title}</h1>
			<p class="hero-description">{description}</p>
		</div>
	</div>
	{#if enabled !== undefined && onToggle}
		<div class="hero-toggle">
			<p class="hero-toggle-label">Enabled</p>
			<Toggle checked={enabled} {onToggle} size="lg" label="Toggle {title}" />
		</div>
	{/if}
</header>

<style>
	.hero-shell {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1rem 0.9rem;
		border: 1px solid rgb(39 39 42 / 0.9);
		border-radius: 1rem;
		background: linear-gradient(180deg, rgb(24 24 27 / 0.78), rgb(24 24 27 / 0.55));
	}

	.hero-main {
		display: flex;
		align-items: flex-start;
		gap: 0.8rem;
		min-width: 0;
	}

	.hero-icon-wrap {
		display: grid;
		place-items: center;
		height: 2.5rem;
		width: 2.5rem;
		flex-shrink: 0;
		border-radius: 0.8rem;
		border: 1px solid rgb(63 63 70 / 0.9);
		background: rgb(9 9 11 / 0.8);
	}

	.hero-kicker {
		font-size: 0.69rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: rgb(113 113 122);
	}

	.hero-title {
		margin-top: 0.2rem;
		font-size: clamp(1.45rem, 2vw, 1.95rem);
		font-weight: 650;
		line-height: 1.1;
		color: rgb(250 250 250);
	}

	.hero-description {
		margin-top: 0.45rem;
		max-width: 50rem;
		font-size: 0.9rem;
		line-height: 1.45;
		color: rgb(161 161 170);
	}

	.hero-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.8rem;
		border: 1px solid rgb(63 63 70 / 0.9);
		background: rgb(9 9 11 / 0.55);
	}

	.hero-toggle-label {
		font-size: 0.76rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(161 161 170);
	}

	@media (max-width: 720px) {
		.hero-shell {
			flex-direction: column;
		}

		.hero-toggle {
			align-self: flex-start;
		}
	}
</style>

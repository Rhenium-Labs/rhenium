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

<header class="page-header">
	<div class="page-header-main">
		{#if Icon}
			<div class="page-header-icon">
				<Icon class="h-4 w-4 text-zinc-300" strokeWidth={1.9} />
			</div>
		{/if}
		<div>
			<h1 class="page-header-title">{title}</h1>
			{#if description}
				<p class="page-header-description">{description}</p>
			{/if}
		</div>
	</div>
	{#if enabled !== undefined && onToggle}
		<div class="page-header-toggle">
			<Toggle checked={enabled} {onToggle} size="lg" label="Toggle {title}" />
		</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.25rem 0 0.15rem;
	}

	.page-header-main {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}

	.page-header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 1.25rem;
		width: 1.25rem;
		flex-shrink: 0;
	}

	.page-header-title {
		font-size: clamp(1.14rem, 1.6vw, 1.45rem);
		font-weight: 600;
		line-height: 1.15;
		color: rgb(244 244 245);
	}

	.page-header-description {
		margin-top: 0.25rem;
		font-size: 0.82rem;
		line-height: 1.4;
		color: rgb(161 161 170);
	}

	.page-header-toggle {
		display: flex;
		align-items: center;
		padding-left: 0.5rem;
	}

	@media (max-width: 720px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.page-header-toggle {
			align-self: flex-start;
			padding-left: 0;
		}
	}
</style>

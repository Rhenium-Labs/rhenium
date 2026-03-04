<script lang="ts">
	import { Ban, Bell, FileText, Filter, Flag, KeyRound, Trash2, VolumeX } from "@lucide/svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type ModuleItem = {
		id: string;
		name: string;
		description: string;
		cta: string;
		path: string;
		icon: typeof Flag;
	};

	const modules: ModuleItem[] = [
		{
			id: "message-reports",
			name: "Message Reports",
			description: "Let members report problematic messages.",
			cta: "Configure reports",
			path: "message-reports",
			icon: Flag
		},
		{
			id: "ban-requests",
			name: "Ban Requests",
			description: "Require approval before bans are executed.",
			cta: "Review settings",
			path: "ban-requests",
			icon: Ban
		},
		{
			id: "content-filter",
			name: "Content Filter",
			description: "Automatically moderate unsafe content.",
			cta: "Open filter",
			path: "content-filter",
			icon: Filter
		},
		{
			id: "highlights",
			name: "Highlights",
			description: "Allow users to subscribe to keyword alerts.",
			cta: "Manage highlights",
			path: "highlights",
			icon: Bell
		},
		{
			id: "quick-mutes",
			name: "Quick Mutes",
			description: "Mute members quickly through reaction flow.",
			cta: "Configure mutes",
			path: "quick-mutes",
			icon: VolumeX
		},
		{
			id: "quick-purges",
			name: "Quick Purges",
			description: "Bulk-remove messages in a few clicks.",
			cta: "Configure purges",
			path: "quick-purges",
			icon: Trash2
		},
		{
			id: "logging",
			name: "Logging Webhooks",
			description: "Route moderation events to webhook channels.",
			cta: "View webhooks",
			path: "logging",
			icon: FileText
		},
		{
			id: "permissions",
			name: "Permission Scopes",
			description: "Control which roles can use each capability.",
			cta: "Edit scopes",
			path: "permissions",
			icon: KeyRound
		}
	];

	function getDisplayName(session: typeof data.session) {
		return session.globalName ?? session.username ?? "User";
	}

	function getModuleHref(path: string) {
		return `/servers/${data.guild.id}/${path}`;
	}
</script>

<div class="home-page">
	<div class="home-bg-glow" aria-hidden="true"></div>

	<header class="home-hero">
		<h1 class="home-title">
			Welcome <span class="home-title-accent">{getDisplayName(data.session)}</span>,
		</h1>
		<p class="home-subtitle">find commonly used dashboard pages below.</p>
	</header>

	<div class="module-grid">
		{#each modules as module (module.id)}
			<article class="module-card {module.id === 'ban-requests' ? 'is-featured' : ''}">
				<div class="module-icon-wrap">
					<module.icon class="h-5 w-5 text-zinc-100" strokeWidth={2} />
				</div>
				<h2 class="module-title">{module.name}</h2>
				<p class="module-description">{module.description}</p>
				<a href={getModuleHref(module.path)} class="module-action">{module.cta}</a>
			</article>
		{/each}
	</div>
</div>

<style>
	.home-page {
		position: relative;
		overflow: hidden;
	}

	.home-bg-glow {
		position: absolute;
		top: 1.25rem;
		right: -5rem;
		height: 19rem;
		width: 19rem;
		border-radius: 9999px;
		background: radial-gradient(
			circle at center,
			rgb(244 244 245 / 0.18) 0%,
			rgb(244 244 245 / 0) 65%
		);
		filter: blur(8px);
		pointer-events: none;
		z-index: 0;
	}

	.home-hero {
		position: relative;
		z-index: 1;
		margin-bottom: 1.1rem;
	}

	.home-title {
		font-size: clamp(2rem, 3vw, 2.6rem);
		line-height: 1.05;
		font-weight: 700;
		color: rgb(244 244 245);
	}

	.home-title-accent {
		color: rgb(244 244 245);
		text-decoration: underline;
		text-decoration-color: rgb(113 113 122 / 0.65);
		text-underline-offset: 0.18em;
	}

	.home-subtitle {
		margin-top: 0.65rem;
		font-size: clamp(1rem, 1.5vw, 1.2rem);
		line-height: 1.35;
		color: rgb(161 161 170);
	}

	.module-grid {
		position: relative;
		z-index: 1;
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.module-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.65rem;
		min-height: 13.3rem;
		padding: 1rem 1.05rem;
		border-radius: 0.9rem;
		border: 1px solid rgb(63 63 70 / 0.62);
		background: rgb(39 39 42 / 0.78);
		transition:
			border-color 170ms ease,
			background-color 170ms ease;
	}

	.module-card:hover {
		border-color: rgb(82 82 91 / 0.95);
		background: rgb(39 39 42 / 0.9);
	}

	.module-card.is-featured {
		background:
			radial-gradient(circle at 96% 12%, rgb(244 244 245 / 0.14), transparent 46%),
			rgb(39 39 42 / 0.78);
	}

	.module-icon-wrap {
		display: grid;
		place-items: center;
		height: 1.95rem;
		width: 1.95rem;
		border-radius: 0.45rem;
		color: rgb(244 244 245);
	}

	.module-title {
		font-size: 1.02rem;
		font-weight: 600;
		line-height: 1.2;
		color: rgb(244 244 245);
	}

	.module-description {
		font-size: 0.95rem;
		line-height: 1.35;
		color: rgb(212 212 216);
		max-width: 38ch;
	}

	.module-action {
		margin-top: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 0.85rem;
		border-radius: 0.6rem;
		border: 1px solid rgb(63 63 70 / 0.95);
		background: rgb(63 63 70 / 0.62);
		font-size: 0.79rem;
		font-weight: 600;
		color: rgb(244 244 245);
		transition:
			background-color 150ms ease,
			border-color 150ms ease;
	}

	.module-action:hover {
		background: rgb(82 82 91 / 0.75);
		border-color: rgb(113 113 122 / 0.95);
	}

	@media (max-width: 960px) {
		.module-grid {
			grid-template-columns: 1fr;
		}

		.module-card {
			min-height: 11rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.module-card,
		.module-action {
			transition: none !important;
		}
	}
</style>

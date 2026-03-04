<script lang="ts">
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const modules = $derived([
		{
			id: "message-reports",
			name: "Message Reports",
			description: "Let users alert you to problematic messages.",
			icon: "flag",
			href: `/servers/${data.guild.id}/message-reports`,
			button: "Configure"
		},
		{
			id: "ban-requests",
			name: "Ban Requests",
			description: "Require higher level moderator approval for banning users.",
			icon: "ban",
			href: `/servers/${data.guild.id}/ban-requests`,
			button: "Configure"
		},
		{
			id: "content-filter",
			name: "Content Filter",
			description: "Automatic content moderation powered by the OpenAI Moderations API.",
			icon: "filter",
			href: `/servers/${data.guild.id}/content-filter`,
			button: "Configure"
		},
		{
			id: "highlights",
			name: "Highlights",
			description: "Let users subscribe to regex-based message highlights.",
			icon: "bell",
			href: `/servers/${data.guild.id}/highlights`,
			button: "Configure"
		},
		{
			id: "quick-mutes",
			name: "Quick Mutes",
			description: "Muting as simple as a reaction.",
			icon: "mute",
			href: `/servers/${data.guild.id}/quick-mutes`,
			button: "Configure"
		},
		{
			id: "quick-purges",
			name: "Quick Purges",
			description: "Bulk deletion of messages as simple as a reaction.",
			icon: "trash",
			href: `/servers/${data.guild.id}/quick-purges`,
			button: "Configure"
		},
		{
			id: "logging",
			name: "Logging Webhooks",
			description: "Keep a record of every action taken by Rhenium.",
			icon: "document",
			href: `/servers/${data.guild.id}/logging`,
			button: "Configure"
		},
		{
			id: "permissions",
			name: "Permission Scopes",
			description: "Manage role-based permission levels for bot commands.",
			icon: "key",
			href: `/servers/${data.guild.id}/permissions`,
			button: "Configure"
		}
	]);

	function getDisplayName(session: typeof data.session) {
		return session.globalName ?? session.username ?? "User";
	}
</script>

<!-- Welcome Section -->
<div class="welcome-section mb-8">
	<h1 class="text-3xl font-bold">
		Welcome <span class="text-sky-400">{getDisplayName(data.session)}</span>,
	</h1>
	<p class="mt-2 text-lg text-zinc-400">find commonly used dashboard pages below.</p>
</div>

<!-- Module Cards Grid -->
<div class="grid gap-6 lg:grid-cols-2">
	{#each modules as module, index (module.id)}
		<div
			class="module-card rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition-[background-color,border-color] hover:border-zinc-700 hover:bg-zinc-900"
			style="--delay: {100 + index * 75}ms"
		>
			<!-- Icon -->
			<div class="mb-4">
				{#if module.icon === "flag"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
						/>
					</svg>
				{:else if module.icon === "document"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
				{:else if module.icon === "ban"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
						/>
					</svg>
				{:else if module.icon === "bell"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
						/>
					</svg>
				{:else if module.icon === "filter"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
						/>
					</svg>
				{:else if module.icon === "mute"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
						/>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
						/>
					</svg>
				{:else if module.icon === "trash"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
				{:else if module.icon === "key"}
					<svg
						class="h-6 w-6 text-zinc-300"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
						/>
					</svg>
				{/if}
			</div>

			<!-- Content -->
			<h2 class="text-xl font-semibold text-white">{module.name}</h2>
			<p class="mt-2 text-sm text-zinc-400">{module.description}</p>

			<!-- Button -->
			<a
				href={module.href}
				class="mt-4 inline-flex items-center rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
			>
				{module.button}
			</a>
		</div>
	{/each}
</div>

<style>
	/* Welcome section fade up */
	.welcome-section {
		animation: fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both;
	}

	@keyframes fade-up {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Module cards staggered entrance */
	.module-card {
		animation: card-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) var(--delay, 0ms) both;
		will-change: transform, opacity;
	}

	@keyframes card-enter {
		from {
			opacity: 0;
			transform: translate3d(0, 20px, 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.welcome-section,
		.module-card {
			animation: none !important;
			transform: none;
			opacity: 1;
		}
	}
</style>

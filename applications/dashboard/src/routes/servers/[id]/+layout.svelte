<script lang="ts">
	import { page } from "$app/stores";
	import { beforeNavigate } from "$app/navigation";
	import type { LayoutData } from "./$types";
	import type { Snippet } from "svelte";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let showServerMenu = $state(false);
	let showUserMenu = $state(false);
	let direction = $state<"up" | "down">("up");

	const isHome = $derived($page.url.pathname === `/servers/${data.guild.id}`);

	const modules = $derived([
		{
			id: "message-reports",
			name: "Message Reports",
			icon: "flag",
			href: `/servers/${data.guild.id}/message-reports`
		},
		{
			id: "ban-requests",
			name: "Ban Requests",
			icon: "ban",
			href: `/servers/${data.guild.id}/ban-requests`
		},
		{
			id: "content-filter",
			name: "Content Filter",
			icon: "filter",
			href: `/servers/${data.guild.id}/content-filter`
		},
		{
			id: "highlights",
			name: "Highlights",
			icon: "bell",
			href: `/servers/${data.guild.id}/highlights`
		},
		{
			id: "quick-mutes",
			name: "Quick Mutes",
			icon: "mute",
			href: `/servers/${data.guild.id}/quick-mutes`
		},
		{
			id: "quick-purges",
			name: "Quick Purges",
			icon: "trash",
			href: `/servers/${data.guild.id}/quick-purges`
		},
		{
			id: "logging",
			name: "Logging Webhooks",
			icon: "document",
			href: `/servers/${data.guild.id}/logging`
		},
		{
			id: "permissions",
			name: "Permission Scopes",
			icon: "key",
			href: `/servers/${data.guild.id}/permissions`
		}
	]);

	function isActiveModule(href: string): boolean {
		return $page.url.pathname.startsWith(href);
	}

	function getInitials(name: string): string {
		return name
			.split(/\s+/)
			.map(word => word[0])
			.slice(0, 2)
			.join("")
			.toUpperCase();
	}

	function getDisplayName(session: typeof data.session) {
		return session.globalName ?? session.username ?? "User";
	}

	function handleClickOutside() {
		showServerMenu = false;
		showUserMenu = false;
	}

	function getRouteIndex(pathname: string): number {
		if (pathname === `/servers/${data.guild.id}`) return -1;
		const idx = modules.findIndex(m => pathname.startsWith(m.href));
		return idx;
	}

	beforeNavigate(({ to }) => {
		if (!to?.url) return;
		const fromIndex = getRouteIndex($page.url.pathname);
		const toIndex = getRouteIndex(to.url.pathname);
		direction = toIndex >= fromIndex ? "up" : "down";
	});
</script>

<svelte:window onclick={handleClickOutside} />

<div class="flex min-h-screen flex-col bg-zinc-950">
	<!-- Top Navbar -->
	<header
		class="navbar fixed top-0 right-0 left-0 z-50 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4"
	>
		<!-- Left: Server Selector -->
		<div class="flex items-center gap-3">
			<div class="relative">
				<button
					onclick={e => {
						e.stopPropagation();
						showServerMenu = !showServerMenu;
					}}
					class="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-zinc-800 {showServerMenu
						? 'bg-zinc-800'
						: ''}"
				>
					{#if data.guild.icon}
						<img
							src={data.guild.icon}
							alt={data.guild.name}
							class="h-6 w-6 rounded-full"
						/>
					{:else}
						<div
							class="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700 text-xs font-medium text-zinc-300"
						>
							{getInitials(data.guild.name)}
						</div>
					{/if}
					<span class="text-sm font-medium text-white">{data.guild.name}</span>
					<svg
						class="h-4 w-4 text-zinc-400 transition-transform {showServerMenu
							? 'rotate-180'
							: ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</button>

				{#if showServerMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="dropdown-menu absolute top-full left-0 z-50 mt-1.5 min-w-44 rounded-lg border border-zinc-700/50 bg-zinc-800 py-1 shadow-xl"
						onclick={e => e.stopPropagation()}
					>
						<a
							href="/servers"
							class="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
						>
							<svg
								class="h-4 w-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 9l4-4 4 4m0 6l-4 4-4-4"
								/>
							</svg>
							Switch Server
						</a>
					</div>
				{/if}
			</div>
		</div>

		<!-- Right: User Menu -->
		<div class="relative">
			<button
				onclick={e => {
					e.stopPropagation();
					showUserMenu = !showUserMenu;
				}}
				class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-zinc-800 {showUserMenu
					? 'bg-zinc-800'
					: ''}"
			>
				<img src={data.session.avatarUrl} alt="Avatar" class="h-7 w-7 rounded-full" />
				<span class="text-zinc-300">{getDisplayName(data.session)}</span>
				<svg
					class="h-4 w-4 text-zinc-500 transition-transform {showUserMenu
						? 'rotate-180'
						: ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>

			{#if showUserMenu}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="dropdown-menu absolute top-full right-0 z-50 mt-1.5 min-w-36 rounded-lg border border-zinc-700/50 bg-zinc-800 py-1 shadow-xl"
					onclick={e => e.stopPropagation()}
				>
					<a
						href="/api/auth/logout"
						class="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
					>
						<svg
							class="h-4 w-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
							/>
						</svg>
						Log out
					</a>
				</div>
			{/if}
		</div>
	</header>

	<!-- Body -->
	<div class="flex flex-1 pt-14">
		<!-- Sidebar -->
		<aside
			class="sidebar fixed top-14 left-0 z-40 flex h-[calc(100vh-3.5rem)] w-64 flex-col border-r border-zinc-800 bg-zinc-900"
		>
			<!-- Navigation -->
			<nav class="flex-1 overflow-y-auto p-3">
				<!-- Home Button -->
				<div class="mb-1 flex justify-center">
					<a
						href="/servers/{data.guild.id}"
						class="home-btn flex items-center rounded-lg text-sm font-medium {isHome
							? 'is-expanded text-white'
							: 'text-zinc-400 hover:text-white'}"
					>
						<svg
							class="h-4 w-4 shrink-0"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
							/>
						</svg>
						<span class="home-label">Home</span>
					</a>
				</div>

				<!-- Modules Section -->
				<div class="mt-6">
					<p
						class="mb-2 px-3 text-xs font-semibold tracking-wider text-zinc-500 uppercase"
					>
						Modules
					</p>
					<div class="space-y-1">
						{#each modules as module (module.id)}
							<a
								href={module.href}
								class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors {isActiveModule(
									module.href
								)
									? 'bg-zinc-800 text-white'
									: 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'}"
							>
								{#if module.icon === "flag"}
									<svg
										class="h-4 w-4"
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
										class="h-4 w-4"
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
										class="h-4 w-4"
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
										class="h-4 w-4"
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
										class="h-4 w-4"
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
										class="h-4 w-4"
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
										class="h-4 w-4"
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
										class="h-4 w-4"
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
								{module.name}
							</a>
						{/each}
					</div>
				</div>
			</nav>
		</aside>

		<!-- Main Content -->
		<div class="ml-64 flex flex-1 flex-col">
			<main class="flex-1 overflow-hidden p-8">
				{#key $page.url.pathname}
					<div class="page-transition" data-direction={direction}>
						{@render children()}
					</div>
				{/key}
			</main>
		</div>
	</div>
</div>

<style>
	/* Navbar fade in */
	.navbar {
		animation: navbar-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes navbar-enter {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Sidebar slide in from left */
	.sidebar {
		animation: sidebar-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
	}

	@keyframes sidebar-enter {
		from {
			opacity: 0;
			transform: translateX(-20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	/* Home button transitions */
	.home-btn {
		padding: 0.375rem;
		gap: 0;
		background-color: transparent;
		transition:
			padding 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			gap 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			color 0.15s ease;
	}

	.home-btn:hover {
		background-color: rgb(39 39 42 / 0.5);
	}

	.home-btn.is-expanded {
		padding: 0.375rem 0.625rem;
		gap: 0.5rem;
		background-color: rgb(39 39 42);
	}

	.home-btn.is-expanded:hover {
		background-color: rgb(39 39 42);
	}

	.home-label {
		overflow: hidden;
		white-space: nowrap;
		max-width: 0;
		opacity: 0;
		transition:
			max-width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.home-btn.is-expanded .home-label {
		max-width: 4rem;
		opacity: 1;
	}

	/* Page transitions */
	.page-transition {
		animation: page-enter-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	.page-transition[data-direction="down"] {
		animation-name: page-enter-down;
	}

	@keyframes page-enter-up {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes page-enter-down {
		from {
			opacity: 0;
			transform: translateY(-20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Dropdown animation */
	.dropdown-menu {
		animation: dropdown-fade-in 0.15s ease-out;
	}

	@keyframes dropdown-fade-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>

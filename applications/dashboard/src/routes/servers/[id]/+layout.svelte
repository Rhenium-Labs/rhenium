<script lang="ts">
	import { page } from "$app/stores";
	import { beforeNavigate } from "$app/navigation";
	import type { LayoutData } from "./$types";
	import type { Snippet } from "svelte";
	import {
		Home,
		Flag,
		Ban,
		Shield,
		Sparkles,
		VolumeOff,
		Trash2,
		Webhook,
		KeyRound,
		ChevronDown,
		ArrowLeftRight,
		LogOut
	} from "@lucide/svelte";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let showServerMenu = $state(false);
	let showUserMenu = $state(false);
	let direction = $state<"up" | "down">("up");

	const isHome = $derived($page.url.pathname === `/servers/${data.guild.id}`);

	const modules = $derived([
		{
			id: "message-reports",
			name: "Message Reports",
			icon: Flag,
			href: `/servers/${data.guild.id}/message-reports`
		},
		{
			id: "ban-requests",
			name: "Ban Requests",
			icon: Ban,
			href: `/servers/${data.guild.id}/ban-requests`
		},
		{
			id: "content-filter",
			name: "Content Filter",
			icon: Shield,
			href: `/servers/${data.guild.id}/content-filter`
		},
		{
			id: "highlights",
			name: "Highlights",
			icon: Sparkles,
			href: `/servers/${data.guild.id}/highlights`
		},
		{
			id: "quick-mutes",
			name: "Quick Mutes",
			icon: VolumeOff,
			href: `/servers/${data.guild.id}/quick-mutes`
		},
		{
			id: "quick-purges",
			name: "Quick Purges",
			icon: Trash2,
			href: `/servers/${data.guild.id}/quick-purges`
		},
		{
			id: "logging",
			name: "Logging",
			icon: Webhook,
			href: `/servers/${data.guild.id}/logging`
		},
		{
			id: "permissions",
			name: "Permissions",
			icon: KeyRound,
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
		class="navbar fixed top-0 right-0 left-0 z-50 flex h-14 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/80 px-4 backdrop-blur-xl"
	>
		<!-- Left: Server Selector -->
		<div class="flex items-center gap-3">
			<div class="relative">
				<button
					onclick={e => {
						e.stopPropagation();
						showServerMenu = !showServerMenu;
					}}
					class="flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-all hover:bg-zinc-800 {showServerMenu
						? 'bg-zinc-800'
						: ''}"
				>
					{#if data.guild.icon}
						<img
							src={data.guild.icon}
							alt={data.guild.name}
							class="h-6 w-6 rounded-full ring-1 ring-zinc-700/50"
						/>
					{:else}
						<div
							class="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700 text-xs font-medium text-zinc-300"
						>
							{getInitials(data.guild.name)}
						</div>
					{/if}
					<span class="text-sm font-semibold text-white">{data.guild.name}</span>
					<ChevronDown
						class="h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 {showServerMenu
							? 'rotate-180'
							: ''}"
						strokeWidth={2.5}
					/>
				</button>

				{#if showServerMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="dropdown-menu absolute top-full left-0 z-50 mt-1.5 min-w-44 overflow-hidden rounded-lg border border-zinc-700/50 bg-zinc-800/95 shadow-xl backdrop-blur-lg"
						onclick={e => e.stopPropagation()}
					>
						<a
							href="/servers"
							class="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700/50 hover:text-white"
						>
							<ArrowLeftRight
								class="h-4 w-4 text-zinc-500"
								strokeWidth={1.75}
							/>
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
				class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-all hover:bg-zinc-800 {showUserMenu
					? 'bg-zinc-800'
					: ''}"
			>
				<img
					src={data.session.avatarUrl}
					alt="Avatar"
					class="h-7 w-7 rounded-full ring-1 ring-zinc-700/50"
				/>
				<span class="text-zinc-300">{getDisplayName(data.session)}</span>
				<ChevronDown
					class="h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 {showUserMenu
						? 'rotate-180'
						: ''}"
					strokeWidth={2.5}
				/>
			</button>

			{#if showUserMenu}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="dropdown-menu absolute top-full right-0 z-50 mt-1.5 min-w-36 overflow-hidden rounded-lg border border-zinc-700/50 bg-zinc-800/95 shadow-xl backdrop-blur-lg"
					onclick={e => e.stopPropagation()}
				>
					<a
						href="/api/auth/logout"
						class="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700/50 hover:text-white"
					>
						<LogOut class="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
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
			class="sidebar fixed top-14 left-0 z-40 flex h-[calc(100vh-3.5rem)] w-60 flex-col border-r border-zinc-800/80 bg-zinc-900/50 backdrop-blur-xl"
		>
			<nav class="flex-1 overflow-y-auto p-3">
				<!-- Home Button -->
				<div class="mb-1 flex justify-center">
					<a
						href="/servers/{data.guild.id}"
						class="home-btn flex items-center rounded-lg text-sm font-medium {isHome
							? 'is-expanded text-white'
							: 'text-zinc-400 hover:text-white'}"
					>
						<Home class="h-4 w-4 shrink-0" strokeWidth={1.75} />
						<span class="home-label">Home</span>
					</a>
				</div>

				<!-- Modules Section -->
				<div class="mt-5">
					<p
						class="mb-2 px-3 text-[0.65rem] font-semibold tracking-widest text-zinc-600 uppercase"
					>
						Modules
					</p>
					<div class="space-y-0.5">
						{#each modules as module (module.id)}
							{@const active = isActiveModule(module.href)}
							<a
								href={module.href}
								class="nav-item group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[0.8125rem] font-medium transition-all duration-150 {active
									? 'bg-zinc-800/80 text-white'
									: 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-200'}"
							>
								{#if active}
									<span
										class="active-indicator absolute top-1.5 bottom-1.5 left-0 w-0.75 rounded-full bg-indigo-500"
									></span>
								{/if}
								<module.icon
									class="h-4 w-4 shrink-0 {active
										? 'text-indigo-400'
										: 'text-zinc-600 group-hover:text-zinc-400'}"
									strokeWidth={1.75}
								/>
								{module.name}
							</a>
						{/each}
					</div>
				</div>
			</nav>
		</aside>

		<!-- Main Content -->
		<div class="ml-60 flex flex-1 flex-col">
			<main class="flex-1 overflow-y-auto p-8">
				{#key $page.url.pathname}
					<div class="page-transition mx-auto max-w-4xl" data-direction={direction}>
						{@render children()}
					</div>
				{/key}
			</main>
		</div>
	</div>
</div>

<style>
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

	.sidebar {
		animation: sidebar-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
	}
	@keyframes sidebar-enter {
		from {
			opacity: 0;
			transform: translateX(-16px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	/* Home button animated expand/collapse */
	.home-btn {
		padding: 0.375rem;
		gap: 0;
		background-color: transparent;
		transition:
			padding 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			gap 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			background-color 0.2s ease,
			color 0.15s ease;
	}
	.home-btn:hover {
		background-color: rgb(39 39 42 / 0.4);
	}
	.home-btn.is-expanded {
		padding: 0.375rem 0.625rem;
		gap: 0.5rem;
		background-color: rgb(39 39 42 / 0.8);
	}
	.home-btn.is-expanded:hover {
		background-color: rgb(39 39 42 / 0.8);
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

	/* Active sidebar indicator */
	.active-indicator {
		animation: indicator-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes indicator-in {
		from {
			opacity: 0;
			transform: scaleY(0.5);
		}
		to {
			opacity: 1;
			transform: scaleY(1);
		}
	}

	/* Page transitions */
	.page-transition {
		animation: page-enter-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.page-transition[data-direction="down"] {
		animation-name: page-enter-down;
	}

	@keyframes page-enter-up {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes page-enter-down {
		from {
			opacity: 0;
			transform: translateY(-16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Dropdown */
	.dropdown-menu {
		animation: dropdown-fade-in 0.15s ease-out;
	}
	@keyframes dropdown-fade-in {
		from {
			opacity: 0;
			transform: translateY(-4px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	/* Config section/card entrance animations */
	:global(main .config-card) {
		animation: section-enter 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}
	:global(main .config-card:hover) {
		border-color: rgb(63 63 70 / 0.8);
		box-shadow: 0 0 0 1px rgb(63 63 70 / 0.15);
	}

	@keyframes section-enter {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>

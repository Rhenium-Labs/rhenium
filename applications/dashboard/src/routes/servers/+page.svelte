<script lang="ts">
	import { onMount } from "svelte";
	import { goto, invalidateAll } from "$app/navigation";
	import { ChevronDown, ChevronRight, Plus, Loader2, LogOut } from "@lucide/svelte";

	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let showLogoutMenu = $state(false);
	let navigating = $state(false);
	let pendingInviteRefresh = $state(false);
	let serversLoaded = $state(false);
	let pendingServerRefresh: Promise<void> | null = null;
	let serverListAnimationFrame: number | null = null;

	const EXIT_ANIMATION_MS = 300;
	const MAX_STAGGER_INDEX = 12;

	async function refreshIfPendingInvite() {
		if (document.visibilityState !== "visible" || !pendingInviteRefresh) return;

		pendingInviteRefresh = false;
		await refreshServers();
	}

	onMount(() => {
		function handleVisibilityChange() {
			void refreshIfPendingInvite();
		}

		function handleFocus() {
			void refreshIfPendingInvite();
		}

		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("focus", handleFocus);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("focus", handleFocus);

			if (serverListAnimationFrame !== null) {
				cancelAnimationFrame(serverListAnimationFrame);
				serverListAnimationFrame = null;
			}
		};
	});

	async function refreshServers() {
		if (pendingServerRefresh) {
			await pendingServerRefresh;
			return;
		}

		pendingServerRefresh = (async () => {
			await fetch("/api/servers/invalidate-cache", { method: "POST" });
			await invalidateAll();
		})();

		try {
			await pendingServerRefresh;
		} finally {
			pendingServerRefresh = null;
		}
	}

	function handleInviteClick() {
		pendingInviteRefresh = true;
	}

	async function handleServerClick(e: MouseEvent, serverId: string, hasBot: boolean) {
		if (!hasBot || navigating) return;

		e.preventDefault();
		navigating = true;

		await new Promise(resolve => setTimeout(resolve, EXIT_ANIMATION_MS));
		goto(`/servers/${serverId}`);
	}

	function getDisplayName(session: typeof data.session) {
		return session.globalName ?? session.username ?? "User";
	}

	function getInitials(name: string): string {
		return name
			.split(/\s+/)
			.map(word => word[0])
			.slice(0, 2)
			.join("")
			.toUpperCase();
	}

	function handleClickOutside() {
		if (showLogoutMenu) {
			showLogoutMenu = false;
		}
	}

	/** Svelte action: runs client-side only when the node mounts */
	function serversVisible(_node: HTMLElement) {
		serversLoaded = false;

		if (serverListAnimationFrame !== null) {
			cancelAnimationFrame(serverListAnimationFrame);
		}

		serverListAnimationFrame = requestAnimationFrame(() => {
			serverListAnimationFrame = requestAnimationFrame(() => {
				serversLoaded = true;
			});
		});

		return {
			destroy() {
				if (serverListAnimationFrame !== null) {
					cancelAnimationFrame(serverListAnimationFrame);
					serverListAnimationFrame = null;
				}
			}
		};
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="flex min-h-screen items-center justify-center px-4 py-8">
	<div
		class="card-container w-full max-w-md rounded-2xl bg-zinc-900/80 p-6 shadow-xl backdrop-blur"
	>
		<!-- User Info Header -->
		<div class="user-header relative z-20 mb-6 flex items-center justify-center">
			<div class="relative">
				<button
					onclick={e => {
						e.stopPropagation();
						showLogoutMenu = !showLogoutMenu;
					}}
					class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all {showLogoutMenu
						? 'bg-zinc-800 text-white'
						: 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white'}"
				>
					<span class="text-zinc-500">Logged in as</span>
					<img
						src={data.session.avatarUrl}
						alt="Avatar"
						class="h-6 w-6 rounded-full"
					/>
					<span class="font-medium text-white">{getDisplayName(data.session)}</span>
					<ChevronDown
						class="h-4 w-4 text-zinc-500 transition-transform {showLogoutMenu
							? 'rotate-180'
							: ''}"
					/>
				</button>

				{#if showLogoutMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="dropdown-menu absolute top-full right-0 z-10 mt-1.5 min-w-35 overflow-hidden rounded-lg border border-zinc-700/50 bg-zinc-800 shadow-xl"
						onclick={e => e.stopPropagation()}
					>
						<a
							href="/api/auth/logout"
							class="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
						>
							<LogOut class="h-4 w-4" />
							Log out
						</a>
					</div>
				{/if}
			</div>
		</div>

		<!-- Server List Container -->
		<div class="relative h-80 overflow-hidden">
			<!-- Navigating spinner (slides in from right) -->
			<div
				class="absolute inset-0 flex items-center justify-center transition-[transform,opacity] duration-300 ease-out will-change-transform {navigating
					? 'translate-x-0 opacity-100'
					: 'translate-x-full opacity-0'}"
			>
				<Loader2 class="h-8 w-8 animate-spin text-zinc-500" />
			</div>

			<!-- Content (slides out to left when navigating) -->
			<div
				class="h-full transition-[transform,opacity] duration-300 ease-out will-change-transform {navigating
					? '-translate-x-full opacity-0'
					: 'translate-x-0 opacity-100'}"
			>
				{#await data.servers}
					<!-- Loading State -->
					<div class="flex h-full items-center justify-center">
						<Loader2 class="h-8 w-8 animate-spin text-zinc-500" />
					</div>
				{:then servers}
					<!-- Server List -->
					{#key servers}
						<div class="h-full space-y-1 overflow-y-auto pr-1" use:serversVisible>
							{#each servers as server, index (server.id)}
								{#if server.hasBot}
									<a
										href="/servers/{server.id}"
										onclick={e =>
											handleServerClick(e, server.id, true)}
										class="server-item group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-zinc-800"
										style="--delay: {Math.min(
											index,
											MAX_STAGGER_INDEX
										) * 40}ms"
										class:animated={serversLoaded}
									>
										{#if server.icon}
											<img
												src={server.icon}
												alt={server.name}
												class="h-10 w-10 shrink-0 rounded-xl"
											/>
										{:else}
											<div
												class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-700 text-xs font-medium text-zinc-300"
											>
												{getInitials(server.name)}
											</div>
										{/if}

										<span
											class="min-w-0 flex-1 truncate font-medium text-white"
										>
											{server.name}
										</span>

										<ChevronRight
											class="h-5 w-5 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400"
										/>
									</a>
								{:else}
									<a
										href={server.inviteUrl}
										target="_blank"
										rel="noopener noreferrer"
										onclick={handleInviteClick}
										class="server-item server-item-muted group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-zinc-800/50"
										style="--delay: {Math.min(
											index,
											MAX_STAGGER_INDEX
										) * 40}ms"
										class:animated={serversLoaded}
									>
										{#if server.icon}
											<img
												src={server.icon}
												alt={server.name}
												class="h-10 w-10 shrink-0 rounded-xl grayscale"
											/>
										{:else}
											<div
												class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-700 text-xs font-medium text-zinc-500"
											>
												{getInitials(server.name)}
											</div>
										{/if}

										<span
											class="min-w-0 flex-1 truncate font-medium text-zinc-400"
										>
											{server.name}
										</span>

										<Plus
											class="h-5 w-5 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400"
										/>
									</a>
								{/if}
							{:else}
								<div class="flex h-full items-center justify-center">
									<div class="text-center">
										<p class="text-zinc-400">No servers found.</p>
										<p class="mt-1 text-sm text-zinc-500">
											You need Manage Server or Admin permission.
										</p>
									</div>
								</div>
							{/each}
						</div>
					{/key}
				{:catch}
					<div class="flex h-full items-center justify-center">
						<div class="text-center">
							<p class="text-red-400">Failed to load servers.</p>
							<p class="mt-1 text-sm text-zinc-500">
								Please try refreshing the page.
							</p>
						</div>
					</div>
				{/await}
			</div>
		</div>
	</div>
</div>

<style>
	/* Card entrance animation */
	.card-container {
		animation: card-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes card-enter {
		from {
			opacity: 0;
			transform: translateY(20px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	/* User header fade in */
	.user-header {
		animation: fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
	}

	@keyframes fade-up {
		from {
			opacity: 0;
			transform: translateY(10px);
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

	/* Server item staggered entrance */
	.server-item {
		opacity: 0;
		transform: translate3d(0, 12px, 0);
		will-change: transform, opacity;
		backface-visibility: hidden;
	}

	.server-item.animated {
		animation: server-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1) var(--delay, 0ms) forwards;
	}

	@keyframes server-enter {
		from {
			opacity: 0;
			transform: translate3d(0, 12px, 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}

	/* For servers without bot, animate to reduced opacity */
	.server-item-muted.animated {
		animation: server-enter-muted 0.35s cubic-bezier(0.16, 1, 0.3, 1) var(--delay, 0ms)
			forwards;
	}

	.server-item-muted.animated:hover {
		opacity: 0.7;
	}

	@keyframes server-enter-muted {
		from {
			opacity: 0;
			transform: translate3d(0, 12px, 0);
		}
		to {
			opacity: 0.5;
			transform: translate3d(0, 0, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card-container,
		.user-header,
		.dropdown-menu,
		.server-item.animated,
		.server-item-muted.animated {
			animation: none !important;
		}

		.server-item,
		.server-item-muted {
			opacity: 1;
			transform: none;
		}
	}
</style>

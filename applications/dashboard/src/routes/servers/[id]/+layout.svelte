<script lang="ts">
	import { page } from "$app/stores";
	import { afterNavigate, beforeNavigate, goto } from "$app/navigation";
	import { onDestroy } from "svelte";
	import type { LayoutData } from "./$types";
	import type { Snippet } from "svelte";
	import {
		ArrowLeft,
		Home,
		Flag,
		Ban,
		Shield,
		Sparkles,
		VolumeOff,
		Trash2,
		Webhook,
		KeyRound,
		LogOut,
		Loader2
	} from "@lucide/svelte";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let direction = $state<"up" | "down">("up");
	let navPhase = $state<"idle" | "loading" | "revealing">("idle");
	let pendingCategoryTarget: string | null = null;
	let pendingCategoryNavigation = false;
	let navDelayTimeout: ReturnType<typeof setTimeout> | undefined;
	let revealTimeout: ReturnType<typeof setTimeout> | undefined;
	let loadingStartedAt = 0;

	const CATEGORY_NAV_DELAY_MS = 70;
	const CATEGORY_MIN_LOADING_MS = 200;
	const CATEGORY_REVEAL_MS = 220;

	const modules = $derived([
		{
			id: "home",
			name: "Home",
			icon: Home,
			href: `/servers/${data.guild.id}`
		},
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

	function isRouteMatch(href: string, pathname: string): boolean {
		const homeHref = `/servers/${data.guild.id}`;
		if (href === homeHref) return pathname === homeHref;
		return pathname.startsWith(href);
	}

	const activeModule = $derived(
		modules.find(module => isRouteMatch(module.href, $page.url.pathname)) ?? modules[0]
	);

	function isActiveModule(href: string): boolean {
		return isRouteMatch(href, $page.url.pathname);
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

	function getRouteIndex(pathname: string): number {
		const idx = modules.findIndex(m => isRouteMatch(m.href, pathname));
		return idx;
	}

	function shouldBypassIntercept(event: MouseEvent): boolean {
		return (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		);
	}

	function navigateToCategory(event: MouseEvent, href: string) {
		if (shouldBypassIntercept(event)) return;
		if (navPhase !== "idle") {
			event.preventDefault();
			return;
		}
		if (href === $page.url.pathname) return;

		event.preventDefault();

		const fromIndex = getRouteIndex($page.url.pathname);
		const toIndex = getRouteIndex(href);
		direction = toIndex >= fromIndex ? "up" : "down";

		pendingCategoryNavigation = true;
		pendingCategoryTarget = href;
		navPhase = "loading";
		loadingStartedAt = Date.now();

		if (navDelayTimeout) clearTimeout(navDelayTimeout);
		if (revealTimeout) clearTimeout(revealTimeout);

		navDelayTimeout = setTimeout(() => {
			navDelayTimeout = undefined;
			void goto(href);
		}, CATEGORY_NAV_DELAY_MS);
	}

	beforeNavigate(({ to }) => {
		if (!to?.url) return;

		const fromIndex = getRouteIndex($page.url.pathname);
		const toIndex = getRouteIndex(to.url.pathname);
		direction = toIndex >= fromIndex ? "up" : "down";
	});

	afterNavigate(({ to }) => {
		if (!pendingCategoryNavigation) return;
		if (!to?.url || to.url.pathname !== pendingCategoryTarget) return;

		const elapsed = Date.now() - loadingStartedAt;
		const remainingLoading = Math.max(0, CATEGORY_MIN_LOADING_MS - elapsed);

		if (revealTimeout) clearTimeout(revealTimeout);
		revealTimeout = setTimeout(() => {
			navPhase = "revealing";

			revealTimeout = setTimeout(() => {
				navPhase = "idle";
				pendingCategoryNavigation = false;
				pendingCategoryTarget = null;
				revealTimeout = undefined;
			}, CATEGORY_REVEAL_MS);
		}, remainingLoading);
	});

	onDestroy(() => {
		if (navDelayTimeout) clearTimeout(navDelayTimeout);
		if (revealTimeout) clearTimeout(revealTimeout);
	});
</script>

<div class="dashboard-shell">
	<aside class="dashboard-sidebar">
		<div class="sidebar-top">
			<a href="/servers" class="sidebar-back-link">
				<ArrowLeft class="h-4 w-4" strokeWidth={2} />
				Servers
			</a>
			<div class="server-chip">
				{#if data.guild.icon}
					<img
						src={data.guild.icon}
						alt={data.guild.name}
						class="server-chip-avatar"
					/>
				{:else}
					<div class="server-chip-fallback">{getInitials(data.guild.name)}</div>
				{/if}
				<div class="server-chip-copy">
					<p class="server-chip-title">{data.guild.name}</p>
					<p class="server-chip-subtitle">ID: {data.guild.id}</p>
				</div>
			</div>
		</div>

		<nav class="sidebar-nav">
			{#each modules as module (module.id)}
				{@const active = isActiveModule(module.href)}
				<a
					href={module.href}
					onclick={event => navigateToCategory(event, module.href)}
					class="sidebar-nav-item {active ? 'is-active' : ''}"
				>
					<module.icon class="h-4 w-4" strokeWidth={1.8} />
					<span>{module.name}</span>
				</a>
			{/each}
		</nav>

		<div class="sidebar-bottom">
			<div class="account-chip">
				<img src={data.session.avatarUrl} alt="Avatar" class="account-avatar" />
				<div class="account-copy">
					<p class="account-name">{getDisplayName(data.session)}</p>
					<p class="account-username">@{data.session.username}</p>
				</div>
			</div>
			<a href="/api/auth/logout" class="sidebar-signout">
				<LogOut class="h-3.5 w-3.5" strokeWidth={1.9} />
				Sign out
			</a>
		</div>
	</aside>

	<div class="dashboard-main">
		<div class="mobile-nav-wrap">
			<nav class="mobile-nav">
				{#each modules as module (module.id)}
					{@const active = isActiveModule(module.href)}
					<a
						href={module.href}
						onclick={event => navigateToCategory(event, module.href)}
						class="mobile-nav-item {active ? 'is-active' : ''}"
					>
						<module.icon class="h-4 w-4" strokeWidth={1.75} />
						{module.name}
					</a>
				{/each}
			</nav>
		</div>

		<main class="workspace-content" aria-busy={navPhase !== "idle"}>
			{#if navPhase === "loading"}
				<div class="loading-shell" data-direction={direction}>
					<div class="loading-pill">
						<Loader2 class="h-4 w-4 animate-spin" />
						Loading
					</div>
				</div>
			{:else}
				{#key $page.url.pathname}
					<div
						class="route-frame {navPhase === 'revealing' ? 'is-revealing' : ''}"
						data-direction={direction}
					>
						{@render children()}
					</div>
				{/key}
			{/if}
		</main>
	</div>
</div>

<style>
	.dashboard-shell {
		display: grid;
		grid-template-columns: 20rem minmax(0, 1fr);
		min-height: 100vh;
		background: rgb(9 9 11);
	}

	.dashboard-sidebar {
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.1rem;
		border-right: 1px solid rgb(39 39 42 / 0.85);
		background: linear-gradient(180deg, rgb(9 9 11 / 0.98) 0%, rgb(9 9 11 / 0.93) 100%);
		backdrop-filter: blur(12px);
		animation: shell-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.sidebar-top {
		display: grid;
		gap: 0.75rem;
	}

	.sidebar-back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		width: fit-content;
		padding: 0.45rem 0.6rem;
		border-radius: 0.65rem;
		color: rgb(161 161 170);
		font-size: 0.79rem;
		transition:
			background-color 160ms ease,
			color 160ms ease;
	}
	.sidebar-back-link:hover {
		background: rgb(24 24 27);
		color: rgb(244 244 245);
	}

	.server-chip {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.7rem;
		border: 1px solid rgb(39 39 42 / 0.9);
		border-radius: 0.85rem;
		background: rgb(24 24 27 / 0.72);
	}
	.server-chip-avatar,
	.server-chip-fallback {
		height: 2.3rem;
		width: 2.3rem;
		border-radius: 0.65rem;
		object-fit: cover;
		flex-shrink: 0;
	}
	.server-chip-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(39 39 42);
		font-size: 0.72rem;
		font-weight: 700;
		color: rgb(212 212 216);
	}
	.server-chip-copy {
		min-width: 0;
	}
	.server-chip-title {
		font-size: 0.87rem;
		font-weight: 600;
		color: rgb(244 244 245);
		line-height: 1.2;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
	.server-chip-subtitle {
		margin-top: 0.15rem;
		font-size: 0.72rem;
		color: rgb(113 113 122);
	}

	.sidebar-nav {
		min-height: 0;
		overflow: auto;
		display: grid;
		gap: 0.2rem;
		padding-right: 0.15rem;
	}

	.sidebar-nav-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.56rem 0.65rem;
		border-radius: 0.65rem;
		font-size: 0.83rem;
		font-weight: 500;
		color: rgb(161 161 170);
		transition:
			background-color 180ms ease,
			color 180ms ease,
			transform 120ms ease;
	}
	.sidebar-nav-item:hover {
		background: rgb(24 24 27);
		color: rgb(228 228 231);
	}
	.sidebar-nav-item.is-active {
		background: rgb(39 39 42 / 0.9);
		border: 1px solid rgb(82 82 91 / 0.85);
		color: rgb(244 244 245);
	}

	.sidebar-bottom {
		display: grid;
		gap: 0.65rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgb(39 39 42 / 0.8);
	}
	.account-chip {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.2rem;
	}
	.account-avatar {
		height: 2rem;
		width: 2rem;
		border-radius: 9999px;
		border: 1px solid rgb(63 63 70);
	}
	.account-copy {
		min-width: 0;
	}
	.account-name {
		font-size: 0.81rem;
		font-weight: 500;
		color: rgb(228 228 231);
		line-height: 1.25;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
	.account-username {
		font-size: 0.72rem;
		color: rgb(113 113 122);
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
	.sidebar-signout {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.52rem 0.7rem;
		border-radius: 0.65rem;
		border: 1px solid rgb(63 63 70 / 0.9);
		font-size: 0.78rem;
		font-weight: 500;
		color: rgb(212 212 216);
		transition:
			background-color 160ms ease,
			border-color 160ms ease,
			color 160ms ease;
	}
	.sidebar-signout:hover {
		background: rgb(24 24 27);
		border-color: rgb(113 113 122);
		color: rgb(244 244 245);
	}

	.dashboard-main {
		min-width: 0;
		padding: 1.25rem 1.35rem 1.5rem;
	}

	.mobile-nav-wrap {
		display: none;
	}

	.workspace-content {
		isolation: isolate;
	}

	.route-frame {
		max-width: 80rem;
		margin: 0 auto;
	}
	.route-frame.is-revealing {
		animation: page-enter-up 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	.route-frame.is-revealing[data-direction="down"] {
		animation-name: page-enter-down;
	}

	.loading-shell {
		display: flex;
		justify-content: center;
		align-items: center;
		height: calc(100vh - 7.5rem);
		animation: spinner-stage-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.loading-shell[data-direction="down"] {
		animation-name: spinner-stage-down;
	}
	.loading-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: 0.75rem;
		border: 1px solid rgb(39 39 42 / 0.95);
		background: rgb(24 24 27 / 0.85);
		font-size: 0.83rem;
		color: rgb(212 212 216);
	}

	@keyframes shell-enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes page-enter-up {
		from {
			opacity: 0;
			transform: translate3d(0, 16px, 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}

	@keyframes page-enter-down {
		from {
			opacity: 0;
			transform: translate3d(0, -16px, 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}

	@keyframes spinner-stage-up {
		from {
			opacity: 0;
			transform: translate3d(0, 10px, 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}

	@keyframes spinner-stage-down {
		from {
			opacity: 0;
			transform: translate3d(0, -10px, 0);
		}
		to {
			opacity: 1;
			transform: translate3d(0, 0, 0);
		}
	}

	@media (max-width: 1120px) {
		.dashboard-shell {
			grid-template-columns: 1fr;
		}

		.dashboard-sidebar {
			display: none;
		}

		.dashboard-main {
			padding: 1rem;
		}

		.mobile-nav-wrap {
			display: block;
			margin-bottom: 0.9rem;
			overflow-x: auto;
			padding-bottom: 0.25rem;
		}

		.mobile-nav {
			display: inline-flex;
			gap: 0.35rem;
			padding: 0.28rem;
			border-radius: 0.8rem;
			border: 1px solid rgb(39 39 42 / 0.95);
			background: rgb(24 24 27 / 0.78);
		}

		.mobile-nav-item {
			display: inline-flex;
			align-items: center;
			gap: 0.42rem;
			padding: 0.45rem 0.65rem;
			border-radius: 0.6rem;
			font-size: 0.77rem;
			font-weight: 500;
			color: rgb(161 161 170);
			white-space: nowrap;
			transition:
				background-color 150ms ease,
				color 150ms ease;
		}
		.mobile-nav-item:hover {
			background: rgb(39 39 42);
			color: rgb(228 228 231);
		}
		.mobile-nav-item.is-active {
			background: rgb(39 39 42 / 0.92);
			border: 1px solid rgb(82 82 91 / 0.85);
			color: rgb(244 244 245);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dashboard-sidebar,
		.route-frame.is-revealing,
		.loading-shell {
			animation: none !important;
		}

		.route-frame {
			transform: none;
			opacity: 1;
		}
	}
</style>

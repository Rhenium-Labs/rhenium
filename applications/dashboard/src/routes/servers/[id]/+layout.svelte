<script lang="ts">
	import { page, navigating } from "$app/stores";
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
		PencilIcon,
		KeyRound,
		LogOut,
		Menu,
		X
	} from "@lucide/svelte";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let sidebarOpen = $state(false);

	const modules = $derived([
		{ id: "home", name: "Home", icon: Home, href: `/servers/${data.guild.id}` },
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
			icon: PencilIcon,
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
		const homeHref = `/servers/${data.guild.id}`;
		if (href === homeHref) return $page.url.pathname === homeHref;
		return $page.url.pathname.startsWith(href);
	}

	function getDisplayName(session: typeof data.session) {
		return session.globalName ?? session.username ?? "User";
	}

	function getInitials(name: string): string {
		return name
			.split(/\s+/)
			.map(w => w[0])
			.slice(0, 2)
			.join("")
			.toUpperCase();
	}
</script>

<div class="dashboard-shell">
	{#if $navigating}
		<div class="nav-progress" aria-hidden="true">
			<div class="nav-progress-fill"></div>
		</div>
	{/if}
	<!-- Mobile backdrop -->
	{#if sidebarOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="sidebar-backdrop"
			onclick={() => (sidebarOpen = false)}
			onkeydown={e => e.key === "Escape" && (sidebarOpen = false)}
		></div>
	{/if}

	<aside class="dashboard-sidebar" class:is-open={sidebarOpen}>
		<div class="sidebar-top">
			<div class="sidebar-top-row">
				<a href="/servers" class="sidebar-back-link">
					<ArrowLeft class="h-3.5 w-3.5" strokeWidth={2} />
					Servers
				</a>
				<button
					type="button"
					class="sidebar-close-btn"
					onclick={() => (sidebarOpen = false)}
					aria-label="Close sidebar"
				>
					<X class="h-4 w-4" strokeWidth={2} />
				</button>
			</div>

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
				<p class="server-chip-title">{data.guild.name}</p>
			</div>
		</div>

		<nav class="sidebar-nav">
			{#each modules as module (module.id)}
				{@const active = isActiveModule(module.href)}
				<a
					href={module.href}
					onclick={() => (sidebarOpen = false)}
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
				<p class="account-name">{getDisplayName(data.session)}</p>
			</div>
			<a href="/api/auth/logout" class="sidebar-signout">
				<LogOut class="h-3.5 w-3.5" strokeWidth={1.9} />
				Sign out
			</a>
		</div>
	</aside>

	<div class="dashboard-main">
		<div class="mobile-header">
			<button
				type="button"
				class="mobile-menu-btn"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				aria-label="Toggle sidebar"
			>
				<Menu class="h-5 w-5" strokeWidth={1.8} />
			</button>
			<p class="mobile-header-title">{data.guild.name}</p>
		</div>

		<main class="workspace-content">
			{@render children()}
		</main>
	</div>
</div>

<style>
	.dashboard-shell {
		display: grid;
		grid-template-columns: 16rem minmax(0, 1fr);
		min-height: 100vh;
		background: rgb(9 9 11);
	}

	/* ── Sidebar backdrop (mobile only) ── */
	.sidebar-backdrop {
		display: none;
	}

	/* ── Sidebar ── */
	.dashboard-sidebar {
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.9rem 0.75rem;
		border-right: 1px solid rgb(39 39 42 / 0.7);
		background: rgb(9 9 11);
	}

	.sidebar-top {
		display: grid;
		gap: 0.65rem;
	}

	.sidebar-top-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.sidebar-close-btn {
		display: none;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		border-radius: 0.5rem;
		color: rgb(161 161 170);
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}
	.sidebar-close-btn:hover {
		background: rgb(39 39 42);
		color: rgb(244 244 245);
	}

	.sidebar-back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.55rem;
		border-radius: 0.6rem;
		color: rgb(113 113 122);
		font-size: 0.77rem;
		font-weight: 500;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}
	.sidebar-back-link:hover {
		background: rgb(24 24 27);
		color: rgb(228 228 231);
	}

	.server-chip {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.2rem;
	}
	.server-chip-avatar,
	.server-chip-fallback {
		height: 2.1rem;
		width: 2.1rem;
		border-radius: 0.6rem;
		object-fit: cover;
		flex-shrink: 0;
	}
	.server-chip-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(39 39 42);
		font-size: 0.7rem;
		font-weight: 700;
		color: rgb(212 212 216);
	}
	.server-chip-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: rgb(244 244 245);
		line-height: 1.25;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
		min-width: 0;
	}

	.sidebar-nav {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		gap: 0.15rem;
		align-content: start;
	}

	.sidebar-nav-item {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.475rem 0.6rem;
		border-radius: 0.6rem;
		font-size: 0.82rem;
		font-weight: 500;
		color: rgb(113 113 122);
		transition:
			background-color 150ms ease,
			color 150ms ease;
	}
	.sidebar-nav-item:hover {
		background: rgb(24 24 27);
		color: rgb(212 212 216);
	}
	.sidebar-nav-item.is-active {
		background: rgb(24 24 27);
		border: 1px solid rgb(39 39 42);
		color: rgb(244 244 245);
	}

	.sidebar-bottom {
		display: grid;
		gap: 0.55rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgb(39 39 42 / 0.6);
	}

	.account-chip {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.4rem 0.2rem;
	}
	.account-avatar {
		height: 1.75rem;
		width: 1.75rem;
		border-radius: 9999px;
		border: 1px solid rgb(39 39 42);
		flex-shrink: 0;
	}
	.account-name {
		font-size: 0.77rem;
		font-weight: 500;
		color: rgb(212 212 216);
		line-height: 1.25;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
		min-width: 0;
	}
	.sidebar-signout {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.475rem 0.65rem;
		border-radius: 0.6rem;
		border: 1px solid rgb(39 39 42);
		font-size: 0.77rem;
		font-weight: 500;
		color: rgb(161 161 170);
		transition:
			background-color 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}
	.sidebar-signout:hover {
		background: rgb(24 24 27);
		border-color: rgb(63 63 70);
		color: rgb(228 228 231);
	}

	/* ── Main content ── */
	.dashboard-main {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.mobile-header {
		display: none;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid rgb(39 39 42 / 0.6);
		background: rgb(9 9 11 / 0.95);
		backdrop-filter: blur(10px);
		position: sticky;
		top: 0;
		z-index: 10;
	}
	.mobile-menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		border-radius: 0.5rem;
		color: rgb(161 161 170);
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}
	.mobile-menu-btn:hover {
		background: rgb(24 24 27);
		color: rgb(244 244 245);
	}
	.mobile-header-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: rgb(244 244 245);
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}

	.workspace-content {
		flex: 1;
		padding: 2rem 2.5rem;
		max-width: 56rem;
	}

	/* ── Mobile ── */
	@media (max-width: 768px) {
		.dashboard-shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.dashboard-sidebar {
			position: fixed;
			top: 0;
			bottom: 0;
			left: 0;
			z-index: 40;
			width: 16rem;
			transform: translateX(-100%);
			transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
			border-right-color: rgb(39 39 42);
		}
		.dashboard-sidebar.is-open {
			transform: translateX(0);
		}

		.sidebar-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 30;
			background: rgb(0 0 0 / 0.6);
			backdrop-filter: blur(2px);
		}

		.sidebar-close-btn {
			display: flex;
		}

		.mobile-header {
			display: flex;
		}

		.workspace-content {
			padding: 1.25rem 1rem;
		}
	}

	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		z-index: 100;
		overflow: hidden;
		pointer-events: none;
	}

	.nav-progress-fill {
		height: 100%;
		width: 35%;
		background: rgb(161 161 170 / 0.7);
		border-radius: 9999px;
		animation: nav-progress-slide 1.3s ease-in-out infinite;
	}

	@keyframes nav-progress-slide {
		0% {
			margin-left: -35%;
		}
		100% {
			margin-left: 110%;
		}
	}
</style>

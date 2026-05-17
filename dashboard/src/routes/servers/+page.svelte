<script lang="ts">
	import { onMount } from "svelte";
	import { goto, invalidateAll } from "$app/navigation";
	import { ChevronRight, Plus, LogOut } from "@lucide/svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let pendingInviteRefresh = $state(false);
	let pendingServerRefresh: Promise<void> | null = null;
	let developerGuildId = $state("");
	const isDeveloper = $derived(
		(data as PageData & { isDeveloper?: boolean }).isDeveloper ?? false
	);

	const DISCORD_ID_REGEX = /^\d{17,20}$/;
	const canOpenDeveloperGuild = $derived(DISCORD_ID_REGEX.test(developerGuildId.trim()));

	onMount(() => {
		const handleVisibility = () => {
			if (document.visibilityState === "visible") void refreshIfPending();
		};
		const handleFocus = () => void refreshIfPending();
		document.addEventListener("visibilitychange", handleVisibility);
		window.addEventListener("focus", handleFocus);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibility);
			window.removeEventListener("focus", handleFocus);
		};
	});

	async function refreshIfPending() {
		if (!pendingInviteRefresh) return;
		pendingInviteRefresh = false;
		await refreshServers();
	}

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

	async function openDeveloperGuild() {
		const guildId = developerGuildId.trim();
		if (!DISCORD_ID_REGEX.test(guildId)) return;

		await goto(`/servers/${guildId}`);
	}
</script>

<div class="flex min-h-screen items-center justify-center px-4 py-8">
	<div
		class="w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 shadow-2xl backdrop-blur-sm"
		style="animation: slide-up 280ms ease both"
	>
		<!-- User header -->
		<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
			<div class="flex items-center gap-2.5">
				<img src={data.session.avatarUrl} alt="" class="h-7 w-7 rounded-full" />
				<span class="text-sm font-medium text-zinc-100"
					>{getDisplayName(data.session)}</span
				>
			</div>
			<a
				href="/api/auth/logout"
				class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
			>
				<LogOut class="h-3.5 w-3.5" strokeWidth={2} />
				Log out
			</a>
		</div>

		<!-- Server list -->
		<div class="max-h-[240px] overflow-y-auto px-3 py-2">
			{#if isDeveloper}
				<form
					onsubmit={async event => {
						event.preventDefault();
						await openDeveloperGuild();
					}}
					class="mb-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2"
				>
					<p class="text-[11px] font-medium tracking-wide text-amber-300 uppercase">
						Developer Access
					</p>
					<div class="mt-2 flex items-center gap-2">
						<input
							type="text"
							inputmode="numeric"
							placeholder="Server ID"
							bind:value={developerGuildId}
							class="h-8 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 transition-colors outline-none placeholder:text-zinc-500 focus:border-amber-400"
						/>
						<button
							type="submit"
							disabled={!canOpenDeveloperGuild}
							class="h-8 rounded-md bg-amber-500 px-3 text-xs font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
						>
							Open
						</button>
					</div>
				</form>
			{/if}

			{#await data.servers}
				<!-- Skeleton loading -->
				{#each { length: 4 } as _}
					<div class="flex items-center gap-3 px-3 py-2.5">
						<div class="skeleton h-9 w-9 shrink-0 rounded-xl"></div>
						<div
							class="skeleton h-3.5 rounded-md"
							style="width: {(100 + Math.random() * 60) | 0}px"
						></div>
					</div>
				{/each}
			{:then servers}
				{#each servers as server (server.id)}
					{@const isDeveloperOnlyServer =
						(server as { developerOnly?: boolean }).developerOnly === true}
					{#if server.hasBot}
						<a
							href="/servers/{server.id}"
							class="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-zinc-800/70"
						>
							{#if server.icon}
								<img
									src={server.icon}
									alt={server.name}
									class="h-9 w-9 shrink-0 rounded-xl"
								/>
							{:else}
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300"
								>
									{getInitials(server.name)}
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium text-zinc-100">
									{server.name}
								</p>
								{#if isDeveloperOnlyServer}
									<p class="text-[11px] text-amber-300">
										Developer-only listing
									</p>
								{/if}
							</div>
							<ChevronRight
								class="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400"
								strokeWidth={2}
							/>
						</a>
					{:else}
						<a
							href={server.inviteUrl}
							target="_blank"
							rel="noopener noreferrer"
							onclick={handleInviteClick}
							class="group flex items-center gap-3 rounded-xl px-3 py-2.5 opacity-50 transition-opacity hover:opacity-75"
						>
							{#if server.icon}
								<img
									src={server.icon}
									alt={server.name}
									class="h-9 w-9 shrink-0 rounded-xl grayscale"
								/>
							{:else}
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-500"
								>
									{getInitials(server.name)}
								</div>
							{/if}
							<span
								class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-400"
								>{server.name}</span
							>
							<Plus
								class="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400"
								strokeWidth={2}
							/>
						</a>
					{/if}
				{:else}
					<div class="py-10 text-center">
						<p class="text-sm text-zinc-400">No servers found.</p>
						<p class="mt-1 text-xs text-zinc-600">
							You need Manage Server or Administrator permission.
						</p>
					</div>
				{/each}
			{:catch}
				<div class="py-10 text-center">
					<p class="text-sm text-red-400">Failed to load servers.</p>
					<p class="mt-1 text-xs text-zinc-600">Try refreshing the page.</p>
				</div>
			{/await}
		</div>
	</div>
</div>

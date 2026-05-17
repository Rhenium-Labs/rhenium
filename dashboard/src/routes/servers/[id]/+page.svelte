<script lang="ts">
	import { Ban, Bell, FileText, Filter, Flag, KeyRound, Trash2, VolumeX } from "@lucide/svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type GuildWithWhitelist = PageData["guild"] & { contentFilterWhitelisted?: boolean };

	const contentFilterWhitelisted = $derived(
		Boolean((data.guild as GuildWithWhitelist).contentFilterWhitelisted)
	);

	const modules = $derived.by(() => {
		const allModules = [
			{
				id: "message-reports",
				name: "Message Reports",
				description: "Let members report problematic messages to moderators.",
				path: "message-reports",
				icon: Flag
			},
			{
				id: "ban-requests",
				name: "Ban Requests",
				description: "Require approval before bans are executed.",
				path: "ban-requests",
				icon: Ban
			},
			{
				id: "content-filter",
				name: "Content Filter",
				description: "Automatically moderate unsafe content.",
				path: "content-filter",
				icon: Filter
			},
			{
				id: "highlights",
				name: "Highlights",
				description: "Allow users to subscribe to keyword alerts.",
				path: "highlights",
				icon: Bell
			},
			{
				id: "quick-mutes",
				name: "Quick Mutes",
				description: "Mute members quickly through a reaction flow.",
				path: "quick-mutes",
				icon: VolumeX
			},
			{
				id: "quick-purges",
				name: "Quick Purges",
				description: "Bulk-remove messages in a few clicks.",
				path: "quick-purges",
				icon: Trash2
			},
			{
				id: "logging",
				name: "Logging Webhooks",
				description: "Route moderation events to webhook channels.",
				path: "logging",
				icon: FileText
			},
			{
				id: "permissions",
				name: "Permission Scopes",
				description: "Control which roles can use each capability.",
				path: "permissions",
				icon: KeyRound
			}
		];

		return contentFilterWhitelisted
			? allModules
			: allModules.filter(module => module.id !== "content-filter");
	});

	function getDisplayName(session: typeof data.session) {
		return session.globalName ?? session.username ?? "User";
	}

	function getModuleHref(path: string) {
		return `/servers/${data.guild.id}/${path}`;
	}
</script>

<div class="page-content">
	<header class="mb-8">
		<h1 class="text-xl font-semibold tracking-tight text-zinc-50">
			Welcome back, <span class="text-zinc-300">{getDisplayName(data.session)}</span>
		</h1>
		<p class="mt-1 text-sm text-zinc-500">
			Manage your server's Rhenium configuration below.
		</p>
	</header>

	<div class="grid gap-3 sm:grid-cols-2">
		{#each modules as module (module.id)}
			<a
				href={getModuleHref(module.path)}
				class="group flex flex-col gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4 transition-colors duration-150 hover:border-zinc-700/70 hover:bg-zinc-900/60"
			>
				<div
					class="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900"
				>
					<module.icon class="h-4 w-4 text-zinc-400" strokeWidth={1.8} />
				</div>
				<div class="flex-1">
					<p class="text-sm font-semibold text-zinc-100">{module.name}</p>
					<p class="mt-0.5 text-xs leading-relaxed text-zinc-500">
						{module.description}
					</p>
				</div>
				<span
					class="inline-flex w-fit items-center rounded-md border border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors group-hover:border-zinc-700 group-hover:text-zinc-300"
				>
					Configure →
				</span>
			</a>
		{/each}
	</div>
</div>

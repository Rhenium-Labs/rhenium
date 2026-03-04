<script lang="ts">
	import {
		Ban,
		Bell,
		FileText,
		Filter,
		Flag,
		Home,
		KeyRound,
		Trash2,
		VolumeX
	} from "@lucide/svelte";
	import type { PageData } from "./$types";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";

	let { data }: { data: PageData } = $props();

	type ModuleItem = {
		id: string;
		name: string;
		description: string;
		path: string;
		icon: typeof Flag;
	};

	const modules: ModuleItem[] = [
		{
			id: "message-reports",
			name: "Message Reports",
			description: "Let users alert you to problematic messages.",
			path: "message-reports",
			icon: Flag
		},
		{
			id: "ban-requests",
			name: "Ban Requests",
			description: "Require moderator approval for member bans.",
			path: "ban-requests",
			icon: Ban
		},
		{
			id: "content-filter",
			name: "Content Filter",
			description: "Automatic content moderation powered by OpenAI Moderations.",
			path: "content-filter",
			icon: Filter
		},
		{
			id: "highlights",
			name: "Highlights",
			description: "Let users subscribe to regex-based message highlights.",
			path: "highlights",
			icon: Bell
		},
		{
			id: "quick-mutes",
			name: "Quick Mutes",
			description: "Mute members quickly via reaction workflows.",
			path: "quick-mutes",
			icon: VolumeX
		},
		{
			id: "quick-purges",
			name: "Quick Purges",
			description: "Bulk-delete messages quickly via reaction workflows.",
			path: "quick-purges",
			icon: Trash2
		},
		{
			id: "logging",
			name: "Logging Webhooks",
			description: "Keep a record of actions taken by Rhenium.",
			path: "logging",
			icon: FileText
		},
		{
			id: "permissions",
			name: "Permission Scopes",
			description: "Manage role-based permission levels for commands.",
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

<div class="space-y-6">
	<PageHeader
		title={`Welcome, ${getDisplayName(data.session)}`}
		description="Use this page to jump into the modules you configure most often for this server."
		icon={Home}
	/>

	<ConfigSection
		title="Modules"
		description="Each module controls a specific part of your moderation and automation setup."
	>
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each modules as module (module.id)}
				<a
					href={getModuleHref(module.path)}
					class="module-link group rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4 transition-[border-color,background-color,transform] duration-150 hover:border-zinc-600/80 hover:bg-zinc-900/70"
				>
					<div class="flex items-start gap-3">
						<div
							class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-700/80 bg-zinc-900"
						>
							<module.icon class="h-4 w-4 text-zinc-200" strokeWidth={2} />
						</div>
						<div class="min-w-0">
							<h3 class="text-sm font-semibold text-zinc-100">
								{module.name}
							</h3>
							<p class="mt-1 text-xs leading-relaxed text-zinc-400">
								{module.description}
							</p>
						</div>
					</div>
				</a>
			{/each}
		</div>
	</ConfigSection>
</div>

<style>
	.module-link {
		will-change: border-color, background-color;
	}

	@media (prefers-reduced-motion: reduce) {
		.module-link {
			transition: none !important;
		}
	}
</style>

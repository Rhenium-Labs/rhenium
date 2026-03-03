<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { Sparkles } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const config = $derived(data.guild.config.highlights);

	let enabled = $state(false);
	let maxPatterns = $state(15);

	$effect.pre(() => {
		enabled = data.guild.config.highlights.enabled;
		maxPatterns = data.guild.config.highlights.max_patterns;
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);

	const isDirty = $derived(enabled !== config.enabled || maxPatterns !== config.max_patterns);

	beforeNavigate(({ cancel }) => {
		if (!isDirty) return;
		cancel();
		shaking = true;
		setTimeout(() => (shaking = false), 600);
	});

	function resetForm() {
		enabled = config.enabled;
		maxPatterns = config.max_patterns;
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";

		try {
			const response = await fetch(`/api/servers/${data.guild.id}/configs/highlights`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ enabled, maxPatterns })
			});

			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success) {
				throw new Error(payload.error ?? "Failed to save highlights config.");
			}

			await invalidateAll();
			saveStatus = "success";
			setTimeout(() => (saveStatus = "idle"), 2500);
		} catch (error) {
			saveStatus = "error";
			saveError = error instanceof Error ? error.message : "An unknown error occurred.";
			setTimeout(() => (saveStatus = "idle"), 5000);
		}
	}
</script>

<div class="space-y-8">
	<PageHeader
		title="Highlights"
		description="Configure highlight subscriptions and limits."
		icon={Sparkles}
		{enabled}
		onToggle={() => (enabled = !enabled)}
	/>

	<form id="highlights-form" onsubmit={submitConfig} class="space-y-6">
		<ConfigSection
			title="Pattern Limits"
			description="Control the number of highlight patterns each user can create."
		>
			<label for="maxPatterns" class="text-sm font-medium text-zinc-300"
				>Maximum Patterns Per User</label
			>
			<p class="mt-0.5 text-xs text-zinc-500">Allowed range: 1 to 30.</p>
			<input
				id="maxPatterns"
				type="number"
				min="1"
				max="30"
				bind:value={maxPatterns}
				class="mt-2 w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
			/>
		</ConfigSection>
	</form>
</div>

<UnsavedChangesBar
	visible={isDirty || saveStatus !== "idle"}
	{saveStatus}
	{saveError}
	{isDirty}
	{shaking}
	onReset={resetForm}
	formId="highlights-form"
/>

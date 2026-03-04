<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { flip } from "svelte/animate";
	import { fade } from "svelte/transition";
	import {
		Detector,
		ChannelScopingType,
		ContentFilterVerbosity,
		DetectorMode
	} from "@repo/config";
	import { Shield, Plus, Trash2 } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import RoleSelector from "$lib/components/RoleSelector.svelte";
	import type { PageData } from "./$types";

	interface ChannelInfo {
		id: string;
		name: string;
		type: number;
	}

	interface RoleInfo {
		id: string;
		name: string;
		color: number;
		position: number;
		managed: boolean;
	}

	let { data }: { data: PageData } = $props();
	const config = $derived(data.guild.config.content_filter);
	const channels: ChannelInfo[] = $derived(
		data.channels.filter((c: ChannelInfo) => c.type === 0 || c.type === 5)
	);
	const roles: RoleInfo[] = $derived(data.roles);

	let enabled = $state(false);
	let channelId = $state("");
	let useNativeAutomod = $state(false);
	let detectors = $state<Detector[]>([]);
	let detectorMode = $state(DetectorMode.Medium);
	let verbosity = $state(ContentFilterVerbosity.Medium);
	let immuneRoles = $state<string[]>([]);
	let notifyRoles = $state<string[]>([]);
	let channelScoping = $state<Array<{ channelId: string; type: ChannelScopingType }>>([]);
	let ocrKeywordsRaw = $state("");
	let ocrRegexRaw = $state("");

	$effect.pre(() => {
		const cfg = data.guild.config.content_filter;
		enabled = cfg.enabled;
		channelId = "";
		useNativeAutomod = cfg.use_native_automod;
		detectors = [...cfg.detectors];
		detectorMode = cfg.detector_mode;
		verbosity = cfg.verbosity;
		immuneRoles = [...cfg.immune_roles];
		notifyRoles = [...cfg.notify_roles];
		channelScoping = cfg.channel_scoping.map(scope => ({
			channelId: scope.channel_id,
			type: scope.type
		}));
		ocrKeywordsRaw = cfg.ocr_filter_keywords.join("\n");
		ocrRegexRaw = cfg.ocr_filter_regex.join("\n");
	});

	const allDetectors = Object.values(Detector);

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;

	function splitLines(value: string) {
		return value
			.split(/\r?\n/)
			.map(item => item.trim())
			.filter(Boolean);
	}

	const isDirty = $derived(
		enabled !== config.enabled ||
			useNativeAutomod !== config.use_native_automod ||
			JSON.stringify(detectors) !== JSON.stringify(config.detectors) ||
			detectorMode !== config.detector_mode ||
			verbosity !== config.verbosity ||
			JSON.stringify(immuneRoles) !== JSON.stringify(config.immune_roles) ||
			JSON.stringify(notifyRoles) !== JSON.stringify(config.notify_roles) ||
			JSON.stringify(channelScoping) !==
				JSON.stringify(
					config.channel_scoping.map(scope => ({
						channelId: scope.channel_id,
						type: scope.type
					}))
				) ||
			JSON.stringify(splitLines(ocrKeywordsRaw)) !==
				JSON.stringify(config.ocr_filter_keywords) ||
			JSON.stringify(splitLines(ocrRegexRaw)) !== JSON.stringify(config.ocr_filter_regex)
	);

	function triggerShake() {
		shaking = true;
		if (shakeTimeout) clearTimeout(shakeTimeout);
		shakeTimeout = setTimeout(() => {
			shaking = false;
			shakeTimeout = undefined;
		}, 600);
	}

	function scheduleStatusReset(delayMs: number) {
		if (statusTimeout) clearTimeout(statusTimeout);
		statusTimeout = setTimeout(() => {
			saveStatus = "idle";
			statusTimeout = undefined;
		}, delayMs);
	}

	onDestroy(() => {
		if (shakeTimeout) clearTimeout(shakeTimeout);
		if (statusTimeout) clearTimeout(statusTimeout);
	});

	beforeNavigate(({ cancel }) => {
		if (!isDirty) return;
		cancel();
		triggerShake();
	});

	function resetForm() {
		enabled = config.enabled;
		useNativeAutomod = config.use_native_automod;
		detectors = [...config.detectors];
		detectorMode = config.detector_mode;
		verbosity = config.verbosity;
		immuneRoles = [...config.immune_roles];
		notifyRoles = [...config.notify_roles];
		channelScoping = config.channel_scoping.map(scope => ({
			channelId: scope.channel_id,
			type: scope.type
		}));
		ocrKeywordsRaw = config.ocr_filter_keywords.join("\n");
		ocrRegexRaw = config.ocr_filter_regex.join("\n");
	}

	function addScope() {
		const firstChannel = channels[0]?.id;
		if (!firstChannel) return;
		channelScoping = [
			...channelScoping,
			{ channelId: firstChannel, type: ChannelScopingType.Include }
		];
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";
		try {
			const response = await fetch(
				`/api/servers/${data.guild.id}/configs/content-filter`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						enabled,
						channelId: channelId || null,
						useNativeAutomod,
						detectors,
						detectorMode,
						verbosity,
						immuneRoles,
						notifyRoles,
						channelScoping,
						ocrFilterKeywords: splitLines(ocrKeywordsRaw),
						ocrFilterRegex: splitLines(ocrRegexRaw)
					})
				}
			);

			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success)
				throw new Error(payload.error ?? "Failed to save content filter config.");

			await invalidateAll();
			saveStatus = "success";
			scheduleStatusReset(2500);
		} catch (error) {
			saveStatus = "error";
			saveError = error instanceof Error ? error.message : "An unknown error occurred.";
			scheduleStatusReset(5000);
		}
	}
</script>

<div class="space-y-8">
	<PageHeader
		title="Content Filter"
		description="Configure automated moderation detectors and routing."
		icon={Shield}
		{enabled}
		onToggle={() => (enabled = !enabled)}
	/>

	<form id="content-filter-form" onsubmit={submitConfig} class="space-y-6">
		<!-- General Settings -->
		<ConfigSection
			title="General"
			description="Core filter settings and detection sensitivity."
		>
			<div class="space-y-6">
				<div class="grid gap-6 md:grid-cols-2">
					<div>
						<label
							for="cf-webhook-channel"
							class="text-sm font-medium text-zinc-300">Webhook Channel</label
						>
						<select
							id="cf-webhook-channel"
							bind:value={channelId}
							class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						>
							<option value="">No channel selected</option>
							{#each channels as channel}
								<option value={channel.id}>#{channel.name}</option>
							{/each}
						</select>
					</div>
					<div>
						<label
							for="cf-detector-mode"
							class="text-sm font-medium text-zinc-300">Detector Mode</label
						>
						<select
							id="cf-detector-mode"
							bind:value={detectorMode}
							class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						>
							{#each Object.values(DetectorMode) as mode}
								<option value={mode}>{mode}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid gap-6 md:grid-cols-2">
					<div>
						<label for="cf-verbosity" class="text-sm font-medium text-zinc-300"
							>Verbosity</label
						>
						<select
							id="cf-verbosity"
							bind:value={verbosity}
							class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						>
							{#each Object.values(ContentFilterVerbosity) as level}
								<option value={level}>{level}</option>
							{/each}
						</select>
					</div>
					<div class="flex items-end pb-1">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-sm font-medium text-zinc-300">
									Native Automod
								</p>
								<p class="text-xs text-zinc-500">
									Use Discord's built-in automod where possible.
								</p>
							</div>
							<Toggle
								checked={useNativeAutomod}
								onToggle={() => (useNativeAutomod = !useNativeAutomod)}
								label="Toggle native automod"
							/>
						</div>
					</div>
				</div>
			</div>
		</ConfigSection>

		<!-- Detectors -->
		<ConfigSection title="Detectors" description="Select which content detectors are active.">
			<div class="grid gap-2 sm:grid-cols-2">
				{#each allDetectors as detector}
					<label
						class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/50"
					>
						<input
							type="checkbox"
							checked={detectors.includes(detector)}
							onchange={e => {
								const checked = (e.target as HTMLInputElement).checked;
								detectors = checked
									? [...detectors, detector]
									: detectors.filter(item => item !== detector);
							}}
							class="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500/30 focus:ring-offset-0"
						/>
						{detector}
					</label>
				{/each}
			</div>
		</ConfigSection>

		<!-- Roles -->
		<ConfigSection
			title="Roles"
			description="Configure role-based immunities and notifications."
		>
			<div class="space-y-8">
				<RoleSelector
					bind:selected={immuneRoles}
					{roles}
					label="Immune Roles"
					placeholder="Add an immune role…"
				/>
				<RoleSelector
					bind:selected={notifyRoles}
					{roles}
					label="Notify Roles"
					placeholder="Add a notify role…"
					showHere
				/>
			</div>
		</ConfigSection>

		<!-- Channel Scoping -->
		<ConfigSection
			title="Channel Scoping"
			description="Include or exclude specific channels from the content filter."
		>
			<div class="space-y-3">
				{#if channelScoping.length === 0}
					<p class="text-sm text-zinc-500">
						No scoping rules configured — all channels are filtered.
					</p>
				{/if}
				{#each channelScoping as scope, index (scope)}
					<div
						animate:flip={{ duration: 180 }}
						in:fade={{ duration: 140 }}
						out:fade={{ duration: 110 }}
						class="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 md:grid-cols-[1fr_auto_auto]"
					>
						<select
							bind:value={scope.channelId}
							class="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						>
							{#each channels as channel}
								<option value={channel.id}>#{channel.name}</option>
							{/each}
						</select>
						<select
							bind:value={scope.type}
							class="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
						>
							<option value={ChannelScopingType.Include}>Include</option>
							<option value={ChannelScopingType.Exclude}>Exclude</option>
						</select>
						<button
							type="button"
							onclick={() =>
								(channelScoping = channelScoping.filter(
									(_, i) => i !== index
								))}
							class="inline-flex items-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/40"
						>
							<Trash2 class="h-3.5 w-3.5" />
							Remove
						</button>
					</div>
				{/each}
				<button
					type="button"
					onclick={addScope}
					class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
				>
					<Plus class="h-4 w-4" />
					Add Scope
				</button>
			</div>
		</ConfigSection>

		<!-- OCR Filters -->
		<ConfigSection
			title="OCR Filters"
			description="Define keywords and regex patterns to detect in images via optical character recognition."
		>
			<div class="grid gap-6 md:grid-cols-2">
				<div>
					<label for="cf-ocr-keywords" class="text-sm font-medium text-zinc-300"
						>Keywords (one per line)</label
					>
					<textarea
						id="cf-ocr-keywords"
						bind:value={ocrKeywordsRaw}
						rows={8}
						placeholder="Enter keywords, one per line…"
						class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-white transition-colors outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
					></textarea>
				</div>
				<div>
					<label for="cf-ocr-regex" class="text-sm font-medium text-zinc-300"
						>Regex Patterns (one per line)</label
					>
					<textarea
						id="cf-ocr-regex"
						bind:value={ocrRegexRaw}
						rows={8}
						placeholder="Enter regex patterns, one per line…"
						class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-white transition-colors outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
					></textarea>
				</div>
			</div>
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
	formId="content-filter-form"
/>

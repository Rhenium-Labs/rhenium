<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import {
		Detector,
		ChannelScopingType,
		ContentFilterVerbosity,
		DetectorMode
	} from "@repo/config";
	import { Shield } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import RoleSelector from "$lib/components/RoleSelector.svelte";
	import ChannelScopeList from "$lib/components/ChannelScopeList.svelte";
	import Select from "$lib/components/Select.svelte";
	import type { SelectOption } from "$lib/components/Select.svelte";
	import type { PageData } from "./$types";
	import type { ChannelInfo, RoleInfo } from "@repo/trpc";

	let { data }: { data: PageData } = $props();
	const config = $derived(data.guild.config.content_filter);
	const webhookChannels: ChannelInfo[] = $derived(
		data.channels.filter((c: ChannelInfo) => c.type === 0 || c.type === 5)
	);
	const scopingChannels: ChannelInfo[] = $derived.by(() => {
		const scoped = data.channels.filter(
			(channel: ChannelInfo) =>
				channel.type === 0 || channel.type === 4 || channel.type === 5
		);

		const scopedById = new Map(scoped.map(channel => [channel.id, channel]));
		const topLevel = scoped
			.filter(channel => channel.parentId === null || !scopedById.has(channel.parentId))
			.sort((a, b) => a.position - b.position);

		const ordered: ChannelInfo[] = [];
		for (const channel of topLevel) {
			ordered.push(channel);
			if (channel.type === 4) {
				const children = scoped
					.filter(
						candidate =>
							(candidate.type === 0 || candidate.type === 5) &&
							candidate.parentId === channel.id
					)
					.sort((a, b) => a.position - b.position);
				ordered.push(...children);
			}
		}

		return ordered;
	});
	const roles: RoleInfo[] = $derived(data.roles);

	let enabled = $state(false);
	let channelId = $state("");
	let useNativeAutomod = $state(false);
	let detectors = $state<Detector[]>([]);
	let detectorMode = $state(DetectorMode.Medium);
	let verbosity = $state(ContentFilterVerbosity.Medium);
	let immuneRoles = $state<string[]>([]);
	let notifyRoles = $state<string[]>([]);
	let channelScoping = $state<{ uiId: string; channelId: string; type: ChannelScopingType }[]>(
		[]
	);
	let ocrKeywordsRaw = $state("");
	let ocrRegexRaw = $state("");

	$effect.pre(() => {
		const cfg = data.guild.config.content_filter;
		enabled = cfg.enabled;
		channelId = cfg.webhook_channel ?? "";
		useNativeAutomod = cfg.use_native_automod;
		detectors = [...cfg.detectors];
		detectorMode = cfg.detector_mode;
		verbosity = cfg.verbosity;
		immuneRoles = [...cfg.immune_roles];
		notifyRoles = [...cfg.notify_roles];
		channelScoping = cfg.channel_scoping.map(scope => ({
			uiId: scope.channel_id,
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

	function normalizeStringSet(values: string[]) {
		return [...values].sort((a, b) => a.localeCompare(b));
	}

	function normalizeDetectorSet(values: Detector[]) {
		return [...values].sort((a, b) => a.localeCompare(b));
	}

	const isDirty = $derived(
		enabled !== config.enabled ||
			channelId !== (config.webhook_channel ?? "") ||
			useNativeAutomod !== config.use_native_automod ||
			JSON.stringify(normalizeDetectorSet(detectors)) !==
				JSON.stringify(normalizeDetectorSet(config.detectors)) ||
			detectorMode !== config.detector_mode ||
			verbosity !== config.verbosity ||
			JSON.stringify(normalizeStringSet(immuneRoles)) !==
				JSON.stringify(normalizeStringSet(config.immune_roles)) ||
			JSON.stringify(normalizeStringSet(notifyRoles)) !==
				JSON.stringify(normalizeStringSet(config.notify_roles)) ||
			JSON.stringify(
				channelScoping.map(({ channelId, type }) => ({ channelId, type }))
			) !==
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
		channelId = config.webhook_channel ?? "";
		useNativeAutomod = config.use_native_automod;
		detectors = [...config.detectors];
		detectorMode = config.detector_mode;
		verbosity = config.verbosity;
		immuneRoles = [...config.immune_roles];
		notifyRoles = [...config.notify_roles];
		channelScoping = config.channel_scoping.map(scope => ({
			uiId: scope.channel_id,
			channelId: scope.channel_id,
			type: scope.type
		}));
		ocrKeywordsRaw = config.ocr_filter_keywords.join("\n");
		ocrRegexRaw = config.ocr_filter_regex.join("\n");
	}

	function addScope() {
		// handled by ChannelScopeList component
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
						channelScoping: channelScoping.map(({ channelId, type }) => ({
							channelId,
							type
						})),
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

<div class="page-content space-y-8">
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
							class="text-sm font-medium text-zinc-300">Alert Channel</label
						>
						<Select
							bind:value={channelId}
							options={[
								{ value: "", label: "None" },
								...webhookChannels.map(c => ({
									value: c.id,
									label: `#${c.name}`
								}))
							]}
							class="mt-2 w-full"
						/>
					</div>
					<div>
						<label
							for="cf-detector-mode"
							class="text-sm font-medium text-zinc-300">Detector Mode</label
						>
						<Select
							bind:value={detectorMode}
							options={Object.values(DetectorMode).map(m => ({
								value: m,
								label: m
							}))}
							class="mt-2 w-full"
						/>
					</div>
				</div>

				<div class="grid gap-6 md:grid-cols-2">
					<div>
						<label for="cf-verbosity" class="text-sm font-medium text-zinc-300"
							>Verbosity</label
						>
						<Select
							bind:value={verbosity}
							options={Object.values(ContentFilterVerbosity).map(v => ({
								value: v,
								label: v
							}))}
							class="mt-2 w-full"
						/>
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
			<ChannelScopeList bind:scoping={channelScoping} channels={scopingChannels} />
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
						class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-white transition-colors outline-none placeholder:text-zinc-600"
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
						class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-white transition-colors outline-none placeholder:text-zinc-600"
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

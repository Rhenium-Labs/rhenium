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

	const CONTENT_FILTER_TIMEOUT_DURATION_MIN_MS = 60 * 1000;
	const CONTENT_FILTER_TIMEOUT_DURATION_MAX_MS = 28 * 24 * 60 * 60 * 1000;
	const CONTENT_FILTER_TIMEOUT_DURATION_DEFAULT_MS = 10 * 60 * 1000;
	const CONTENT_FILTER_DURATION_REGEX =
		/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?|w|week|weeks?)$/i;
	const CONTENT_FILTER_DURATION_PATTERN =
		"^\\d+\\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?|w|week|weeks?)$";

	type DetectorActionsForm = {
		NSFW: {
			deleteMessage: boolean;
			timeoutUser: boolean;
			timeoutDuration: string;
			applyToTextNsfw: boolean;
		};
		OCR: {
			deleteMessage: boolean;
			timeoutUser: boolean;
			timeoutDuration: string;
		};
		TEXT: {
			deleteMessage: boolean;
			timeoutUser: boolean;
			timeoutDuration: string;
		};
	};

	let enabled = $state(false);
	let channelId = $state("");
	let useNativeAutomod = $state(false);
	let useHeuristicScanner = $state(true);
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

	let nsfwDeleteMessage = $state(false);
	let nsfwTimeoutUser = $state(false);
	let nsfwTimeoutDuration = $state("10m");
	let nsfwApplyToTextNsfw = $state(false);

	let ocrDeleteMessage = $state(false);
	let ocrTimeoutUser = $state(false);
	let ocrTimeoutDuration = $state("10m");

	let textDeleteMessage = $state(false);
	let textTimeoutUser = $state(false);
	let textTimeoutDuration = $state("10m");

	function formatTimeoutDuration(valueMs: number | undefined): string {
		const numericValue =
			typeof valueMs === "number" && Number.isFinite(valueMs)
				? Math.round(valueMs)
				: CONTENT_FILTER_TIMEOUT_DURATION_DEFAULT_MS;

		const bounded = Math.max(
			CONTENT_FILTER_TIMEOUT_DURATION_MIN_MS,
			Math.min(CONTENT_FILTER_TIMEOUT_DURATION_MAX_MS, numericValue)
		);

		if (bounded % 604_800_000 === 0) return `${bounded / 604_800_000}w`;
		if (bounded % 86_400_000 === 0) return `${bounded / 86_400_000}d`;
		if (bounded % 3_600_000 === 0) return `${bounded / 3_600_000}h`;
		if (bounded % 60_000 === 0) return `${bounded / 60_000}m`;

		return `${Math.max(1, Math.round(bounded / 60_000))}m`;
	}

	function parseTimeoutDurationMs(input: string): number | null {
		const match = input.trim().match(CONTENT_FILTER_DURATION_REGEX);
		if (!match) return null;

		const amount = Number.parseInt(match[1]!, 10);
		if (!Number.isFinite(amount) || amount <= 0) return null;

		const unit = match[2]!.toLowerCase();
		const multipliers: Record<string, number> = {
			m: 60_000,
			min: 60_000,
			mins: 60_000,
			minute: 60_000,
			minutes: 60_000,
			h: 3_600_000,
			hr: 3_600_000,
			hrs: 3_600_000,
			hour: 3_600_000,
			hours: 3_600_000,
			d: 86_400_000,
			day: 86_400_000,
			days: 86_400_000,
			w: 604_800_000,
			week: 604_800_000,
			weeks: 604_800_000
		};

		const multiplier = multipliers[unit];
		if (!multiplier) return null;

		const durationMs = amount * multiplier;
		if (!Number.isFinite(durationMs)) return null;

		if (
			durationMs < CONTENT_FILTER_TIMEOUT_DURATION_MIN_MS ||
			durationMs > CONTENT_FILTER_TIMEOUT_DURATION_MAX_MS
		) {
			return null;
		}

		return durationMs;
	}

	function validateDetectorActionDurations(): string | null {
		const durations = [
			{ detector: "NSFW", enabled: nsfwTimeoutUser, value: nsfwTimeoutDuration },
			{ detector: "TEXT", enabled: textTimeoutUser, value: textTimeoutDuration },
			{ detector: "OCR", enabled: ocrTimeoutUser, value: ocrTimeoutDuration }
		];

		for (const item of durations) {
			if (!item.enabled) continue;
			if (parseTimeoutDurationMs(item.value) === null) {
				return `${item.detector} timeout duration is invalid. Use formats like 10m, 2h, 7d, 4w (max 28d).`;
			}
		}

		return null;
	}

	function getDetectorActionsFromConfig(
		cfg: PageData["guild"]["config"]["content_filter"]
	): DetectorActionsForm {
		return {
			NSFW: {
				deleteMessage: cfg.detector_actions?.NSFW?.delete_message ?? false,
				timeoutUser: cfg.detector_actions?.NSFW?.timeout_user ?? false,
				timeoutDuration: formatTimeoutDuration(
					cfg.detector_actions?.NSFW?.timeout_duration_ms
				),
				applyToTextNsfw: cfg.detector_actions?.NSFW?.apply_to_text_nsfw ?? false
			},
			OCR: {
				deleteMessage: cfg.detector_actions?.OCR?.delete_message ?? false,
				timeoutUser: cfg.detector_actions?.OCR?.timeout_user ?? false,
				timeoutDuration: formatTimeoutDuration(
					cfg.detector_actions?.OCR?.timeout_duration_ms
				)
			},
			TEXT: {
				deleteMessage: cfg.detector_actions?.TEXT?.delete_message ?? false,
				timeoutUser: cfg.detector_actions?.TEXT?.timeout_user ?? false,
				timeoutDuration: formatTimeoutDuration(
					cfg.detector_actions?.TEXT?.timeout_duration_ms
				)
			}
		};
	}

	function getDetectorActionsPayload(): DetectorActionsForm {
		const nsfwDurationWhenDisabled = parseTimeoutDurationMs(nsfwTimeoutDuration);
		const ocrDurationWhenDisabled = parseTimeoutDurationMs(ocrTimeoutDuration);
		const textDurationWhenDisabled = parseTimeoutDurationMs(textTimeoutDuration);

		return {
			NSFW: {
				deleteMessage: nsfwDeleteMessage,
				timeoutUser: nsfwTimeoutUser,
				timeoutDuration: nsfwTimeoutUser
					? nsfwTimeoutDuration.trim()
					: formatTimeoutDuration(
							nsfwDurationWhenDisabled ??
								CONTENT_FILTER_TIMEOUT_DURATION_DEFAULT_MS
						),
				applyToTextNsfw: nsfwApplyToTextNsfw
			},
			OCR: {
				deleteMessage: ocrDeleteMessage,
				timeoutUser: ocrTimeoutUser,
				timeoutDuration: ocrTimeoutUser
					? ocrTimeoutDuration.trim()
					: formatTimeoutDuration(
							ocrDurationWhenDisabled ??
								CONTENT_FILTER_TIMEOUT_DURATION_DEFAULT_MS
						)
			},
			TEXT: {
				deleteMessage: textDeleteMessage,
				timeoutUser: textTimeoutUser,
				timeoutDuration: textTimeoutUser
					? textTimeoutDuration.trim()
					: formatTimeoutDuration(
							textDurationWhenDisabled ??
								CONTENT_FILTER_TIMEOUT_DURATION_DEFAULT_MS
						)
			}
		};
	}

	$effect.pre(() => {
		const cfg = data.guild.config.content_filter;
		enabled = cfg.enabled;
		channelId = cfg.webhook_channel ?? "";
		useNativeAutomod = cfg.use_native_automod;
		useHeuristicScanner = cfg.use_heuristic_scanner ?? true;
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

		const detectorActions = getDetectorActionsFromConfig(cfg);
		nsfwDeleteMessage = detectorActions.NSFW.deleteMessage;
		nsfwTimeoutUser = detectorActions.NSFW.timeoutUser;
		nsfwTimeoutDuration = detectorActions.NSFW.timeoutDuration;
		nsfwApplyToTextNsfw = detectorActions.NSFW.applyToTextNsfw;

		ocrDeleteMessage = detectorActions.OCR.deleteMessage;
		ocrTimeoutUser = detectorActions.OCR.timeoutUser;
		ocrTimeoutDuration = detectorActions.OCR.timeoutDuration;

		textDeleteMessage = detectorActions.TEXT.deleteMessage;
		textTimeoutUser = detectorActions.TEXT.timeoutUser;
		textTimeoutDuration = detectorActions.TEXT.timeoutDuration;
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
			useHeuristicScanner !== (config.use_heuristic_scanner ?? true) ||
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
			JSON.stringify(splitLines(ocrRegexRaw)) !==
				JSON.stringify(config.ocr_filter_regex) ||
			JSON.stringify(getDetectorActionsPayload()) !==
				JSON.stringify(getDetectorActionsFromConfig(config))
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
		useHeuristicScanner = config.use_heuristic_scanner ?? true;
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

		const detectorActions = getDetectorActionsFromConfig(config);
		nsfwDeleteMessage = detectorActions.NSFW.deleteMessage;
		nsfwTimeoutUser = detectorActions.NSFW.timeoutUser;
		nsfwTimeoutDuration = detectorActions.NSFW.timeoutDuration;
		nsfwApplyToTextNsfw = detectorActions.NSFW.applyToTextNsfw;

		ocrDeleteMessage = detectorActions.OCR.deleteMessage;
		ocrTimeoutUser = detectorActions.OCR.timeoutUser;
		ocrTimeoutDuration = detectorActions.OCR.timeoutDuration;

		textDeleteMessage = detectorActions.TEXT.deleteMessage;
		textTimeoutUser = detectorActions.TEXT.timeoutUser;
		textTimeoutDuration = detectorActions.TEXT.timeoutDuration;
	}

	function addScope() {
		// handled by ChannelScopeList component
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		const durationError = validateDetectorActionDurations();
		if (durationError) {
			saveStatus = "error";
			saveError = durationError;
			scheduleStatusReset(5000);
			return;
		}

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
						useHeuristicScanner,
						detectorActions: getDetectorActionsPayload(),
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
						<div class="space-y-4">
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
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-sm font-medium text-zinc-300">
										Heuristic Scanner
									</p>
									<p class="text-xs text-zinc-500">
										Use activity-based heuristic scans in addition to
										automated scans.
									</p>
								</div>
								<Toggle
									checked={useHeuristicScanner}
									onToggle={() =>
										(useHeuristicScanner = !useHeuristicScanner)}
									label="Toggle heuristic scanner"
								/>
							</div>
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

		<ConfigSection
			title="Detector Actions"
			description="Configure automatic actions to run when each detector is triggered."
		>
			<div class="space-y-6">
				<div class="space-y-2">
					<h3 class="text-sm font-semibold text-zinc-200">Actions Explained</h3>
					<ul class="list-disc space-y-1 pl-5 text-sm text-zinc-400">
						<li>
							<span class="font-medium text-zinc-300">Delete Message</span> - Deletes
							the offending message before the moderation alert is sent.
						</li>
						<li>
							<span class="font-medium text-zinc-300">Timeout Offender</span> - Applies
							a timeout to the message author for the configured duration.
						</li>
					</ul>
				</div>

				<div class="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-4">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-zinc-200">NSFW Actions</h3>
					</div>
					<div class="my-4 border-t border-zinc-700/60"></div>
					<div class="space-y-4">
						<div class="flex items-center justify-between gap-4">
							<p class="text-sm font-medium text-zinc-300">Delete Message</p>
							<Toggle
								checked={nsfwDeleteMessage}
								onToggle={() => (nsfwDeleteMessage = !nsfwDeleteMessage)}
								label="Toggle NSFW delete message"
							/>
						</div>
						<div>
							<div class="flex items-center justify-between gap-4">
								<p class="text-sm font-medium text-zinc-300">
									Timeout Offender
								</p>
								<Toggle
									checked={nsfwTimeoutUser}
									onToggle={() => (nsfwTimeoutUser = !nsfwTimeoutUser)}
									label="Toggle NSFW timeout user"
								/>
							</div>
							<div
								style="display: grid; grid-template-rows: {nsfwTimeoutUser
									? '1fr'
									: '0fr'}; transition: grid-template-rows 220ms ease, opacity 220ms ease; opacity: {nsfwTimeoutUser
									? '1'
									: '0'};"
							>
								<div class="min-h-0 overflow-hidden">
									<div class="pt-2">
										<label
											for="nsfw-timeout-duration"
											class="text-sm font-medium text-zinc-300"
											>Timeout Duration</label
										>
										<input
											id="nsfw-timeout-duration"
											type="text"
											pattern={CONTENT_FILTER_DURATION_PATTERN}
											placeholder="e.g. 10m, 2h, 7d, 4w"
											bind:value={nsfwTimeoutDuration}
											class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm text-white transition-colors outline-none"
										/>
										<p class="mt-1 text-xs text-zinc-600">
											Supported units: m, h, d, w (max 28d)
										</p>
									</div>
								</div>
							</div>
						</div>
						<div class="flex items-center justify-between gap-4">
							<p class="text-sm font-medium text-zinc-300">
								Apply NSFW Actions To TEXT NSFW
							</p>
							<Toggle
								checked={nsfwApplyToTextNsfw}
								onToggle={() =>
									(nsfwApplyToTextNsfw = !nsfwApplyToTextNsfw)}
								label="Toggle NSFW actions on TEXT NSFW"
							/>
						</div>
					</div>
				</div>

				<div class="grid gap-6 md:grid-cols-2">
					<div class="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-4">
						<h3 class="text-sm font-semibold text-zinc-200">TEXT Actions</h3>
						<div class="my-4 border-t border-zinc-700/60"></div>
						<div class="space-y-4">
							<div class="flex items-center justify-between gap-4">
								<p class="text-sm font-medium text-zinc-300">
									Delete Message
								</p>
								<Toggle
									checked={textDeleteMessage}
									onToggle={() =>
										(textDeleteMessage = !textDeleteMessage)}
									label="Toggle TEXT delete message"
								/>
							</div>
							<div>
								<div class="flex items-center justify-between gap-4">
									<p class="text-sm font-medium text-zinc-300">
										Timeout Offender
									</p>
									<Toggle
										checked={textTimeoutUser}
										onToggle={() =>
											(textTimeoutUser = !textTimeoutUser)}
										label="Toggle TEXT timeout user"
									/>
								</div>
								<div
									style="display: grid; grid-template-rows: {textTimeoutUser
										? '1fr'
										: '0fr'}; transition: grid-template-rows 220ms ease, opacity 220ms ease; opacity: {textTimeoutUser
										? '1'
										: '0'};"
								>
									<div class="min-h-0 overflow-hidden">
										<div class="pt-3">
											<label
												for="text-timeout-duration"
												class="text-sm font-medium text-zinc-300"
												>Timeout Duration</label
											>
											<input
												id="text-timeout-duration"
												type="text"
												pattern={CONTENT_FILTER_DURATION_PATTERN}
												placeholder="e.g. 10m, 2h, 7d, 4w"
												bind:value={textTimeoutDuration}
												class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none"
											/>
											<p class="mt-1 text-xs text-zinc-600">
												Supported units: m, h, d, w (max 28d)
											</p>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>

					<div class="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-4">
						<h3 class="text-sm font-semibold text-zinc-200">OCR Actions</h3>
						<div class="my-4 border-t border-zinc-700/60"></div>
						<div class="space-y-4">
							<div class="flex items-center justify-between gap-4">
								<p class="text-sm font-medium text-zinc-300">
									Delete Message
								</p>
								<Toggle
									checked={ocrDeleteMessage}
									onToggle={() => (ocrDeleteMessage = !ocrDeleteMessage)}
									label="Toggle OCR delete message"
								/>
							</div>
							<div>
								<div class="flex items-center justify-between gap-4">
									<p class="text-sm font-medium text-zinc-300">
										Timeout Offender
									</p>
									<Toggle
										checked={ocrTimeoutUser}
										onToggle={() =>
											(ocrTimeoutUser = !ocrTimeoutUser)}
										label="Toggle OCR timeout user"
									/>
								</div>
								<div
									style="display: grid; grid-template-rows: {ocrTimeoutUser
										? '1fr'
										: '0fr'}; transition: grid-template-rows 220ms ease, opacity 220ms ease; opacity: {ocrTimeoutUser
										? '1'
										: '0'};"
								>
									<div class="min-h-0 overflow-hidden">
										<div class="pt-3">
											<label
												for="ocr-timeout-duration"
												class="text-sm font-medium text-zinc-300"
												>Timeout Duration</label
											>
											<input
												id="ocr-timeout-duration"
												type="text"
												pattern={CONTENT_FILTER_DURATION_PATTERN}
												placeholder="e.g. 10m, 2h, 7d, 4w"
												bind:value={ocrTimeoutDuration}
												class="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none"
											/>
											<p class="mt-1 text-xs text-zinc-600">
												Supported units: m, h, d, w (max 28d)
											</p>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
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

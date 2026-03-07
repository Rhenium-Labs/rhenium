<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { LoggingEvent } from "@repo/config";
	import { Plus, Trash2, PencilIcon } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import Select from "$lib/components/Select.svelte";
	import type { SelectOption } from "$lib/components/Select.svelte";
	import type { PageData } from "./$types";
	import type { ChannelInfo } from "@repo/trpc";

	type WebhookRow = {
		uiId: string;
		id: string | null;
		channelId: string;
		events: LoggingEvent[];
	};

	let { data }: { data: PageData } = $props();
	const channels: ChannelInfo[] = $derived(
		data.channels.filter((c: ChannelInfo) => c.type === 0 || c.type === 5)
	);
	const channelOptions = $derived<SelectOption[]>(
		channels.map(c => ({ value: c.id, label: `#${c.name}` }))
	);
	const configRows = $derived(
		data.guild.config.logging_webhooks.map(webhook =>
			createWebhookRow(webhook.id, webhook.channel_id, webhook.events)
		)
	);
	const allEvents = Object.values(LoggingEvent);
	let nextWebhookUiId = 0;

	let webhooks = $state<WebhookRow[]>([]);
	let newItems = $state(new Set<string>());
	let removing = $state(new Set<string>());

	function createWebhookRow(
		id: string | null,
		channelId: string,
		events: LoggingEvent[]
	): WebhookRow {
		return {
			uiId: id ?? `webhook-${nextWebhookUiId++}`,
			id,
			channelId,
			events: [...events]
		};
	}

	$effect.pre(() => {
		webhooks = data.guild.config.logging_webhooks.map(webhook =>
			createWebhookRow(webhook.id, webhook.channel_id, webhook.events)
		);
	});
	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;

	function normalizeWebhooks(rows: WebhookRow[]) {
		return rows
			.map(row => ({
				id: row.id,
				channelId: row.channelId,
				events: [...row.events].sort((a, b) => a.localeCompare(b))
			}))
			.sort((a, b) => {
				const idCompare = (a.id ?? "").localeCompare(b.id ?? "");
				if (idCompare !== 0) return idCompare;
				return a.channelId.localeCompare(b.channelId);
			});
	}

	const isDirty = $derived(
		JSON.stringify(normalizeWebhooks(webhooks)) !==
			JSON.stringify(normalizeWebhooks(configRows))
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
		webhooks = configRows.map(row => createWebhookRow(row.id, row.channelId, row.events));
	}

	function addWebhook() {
		const channelId = channels[0]?.id;
		if (!channelId) return;
		const newRow = createWebhookRow(null, channelId, [LoggingEvent.MessageReportReviewed]);
		newItems = new Set([...newItems, newRow.uiId]);
		webhooks = [...webhooks, newRow];
		setTimeout(() => {
			newItems = new Set([...newItems].filter(id => id !== newRow.uiId));
		}, 350);
	}

	function removeWebhook(webhookUiId: string) {
		removing = new Set([...removing, webhookUiId]);
		setTimeout(() => {
			webhooks = webhooks.filter(webhook => webhook.uiId !== webhookUiId);
			removing = new Set([...removing].filter(id => id !== webhookUiId));
		}, 220);
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";
		try {
			const response = await fetch(`/api/servers/${data.guild.id}/configs/logging`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ webhooks })
			});

			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success)
				throw new Error(payload.error ?? "Failed to save logging webhooks.");

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
		title="Logging"
		description="Configure webhook destinations and event subscriptions for audit logs."
		icon={PencilIcon}
	/>

	<form id="logging-form" onsubmit={submitConfig} class="space-y-6">
		<ConfigSection
			title="Channels"
			description="Send specific events to specific channels through webhooks."
		>
			<div class="mb-4 flex justify-end">
				<button
					type="button"
					onclick={addWebhook}
					class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
				>
					<Plus class="h-3.5 w-3.5" strokeWidth={2} />
					Add webhook
				</button>
			</div>

			<div class="relative space-y-4">
				{#if webhooks.length === 0}
					<p class="py-2 text-sm text-zinc-600">No webhooks configured.</p>
				{/if}
				{#each webhooks as webhook (webhook.uiId)}
					{@const channel = channels.find(c => c.id === webhook.channelId)}
					<div
						style="display: grid; grid-template-rows: {removing.has(webhook.uiId)
							? '0fr'
							: '1fr'}; transition: grid-template-rows 220ms ease, opacity 220ms ease; opacity: {removing.has(
							webhook.uiId
						)
							? '0'
							: '1'};"
					>
						<div
							class="min-h-0"
							class:overflow-hidden={removing.has(webhook.uiId)}
						>
							<div
								class="{newItems.has(webhook.uiId)
									? 'item-enter'
									: ''} space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
							>
								<div class="flex items-center justify-between gap-3">
									{#if webhook.id === null}
										<Select
											bind:value={webhook.channelId}
											options={channelOptions}
											class="w-full max-w-md"
										/>
									{:else}
										<div
											class="flex w-full max-w-md cursor-default items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white opacity-80 select-none"
										>
											<span class="shrink-0 text-zinc-400">#</span>
											<span class="truncate"
												>{channel?.name ??
													webhook.channelId}</span
											>
										</div>
									{/if}
									<button
										type="button"
										onclick={() => removeWebhook(webhook.uiId)}
										class="inline-flex items-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/40"
									>
										<Trash2 class="h-3.5 w-3.5" strokeWidth={2} />
										Remove
									</button>
								</div>
								<div class="grid gap-x-4 gap-y-2 md:grid-cols-2">
									{#each allEvents as eventName}
										<label
											class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/50"
										>
											<input
												type="checkbox"
												checked={webhook.events.includes(
													eventName
												)}
												onchange={e => {
													const checked = (
														e.target as HTMLInputElement
													).checked;
													webhook.events = checked
														? [
																...webhook.events,
																eventName
															]
														: webhook.events.filter(
																item =>
																	item !==
																	eventName
															);
													webhooks = [...webhooks];
												}}
												class="h-4 w-4 rounded border-zinc-600 bg-zinc-800"
											/>
											{eventName}
										</label>
									{/each}
								</div>
							</div>
						</div>
					</div>
				{/each}
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
	formId="logging-form"
/>

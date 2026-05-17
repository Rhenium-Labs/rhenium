<script lang="ts">
	import { AlertTriangle, Check, Loader2 } from "@lucide/svelte";

	type SaveStatus = "idle" | "saving" | "success" | "error";
	const EXIT_ANIMATION_MS = 220;

	let {
		visible,
		saveStatus,
		saveError,
		isDirty,
		shaking = false,
		onReset,
		formId,
		message = "Careful — you have unsaved changes!"
	}: {
		visible: boolean;
		saveStatus: SaveStatus;
		saveError: string;
		isDirty: boolean;
		shaking?: boolean;
		onReset: () => void;
		formId: string;
		message?: string;
	} = $props();

	let shouldRender = $state(false);
	let exiting = $state(false);
	let hideTimeout: ReturnType<typeof setTimeout> | undefined;
	let displaySaveStatus = $state<SaveStatus>("idle");
	let displaySaveError = $state("");
	let displayIsDirty = $state(false);

	$effect(() => {
		if (!visible || exiting) return;

		displaySaveStatus = saveStatus;
		displaySaveError = saveError;
		displayIsDirty = isDirty;
	});

	$effect(() => {
		if (visible) {
			if (hideTimeout) {
				clearTimeout(hideTimeout);
				hideTimeout = undefined;
			}
			displaySaveStatus = saveStatus;
			displaySaveError = saveError;
			displayIsDirty = isDirty;
			shouldRender = true;
			exiting = false;
			return;
		}

		if (!shouldRender) return;

		exiting = true;
		hideTimeout = setTimeout(() => {
			shouldRender = false;
			exiting = false;
			hideTimeout = undefined;
		}, EXIT_ANIMATION_MS);

		return () => {
			if (hideTimeout) {
				clearTimeout(hideTimeout);
				hideTimeout = undefined;
			}
		};
	});
</script>

{#if shouldRender}
	<div
		class="save-bar fixed right-4 bottom-4 z-50 flex w-[min(calc(100vw-1.5rem),30rem)] flex-col gap-3 rounded-2xl border bg-zinc-900/96 px-4 py-3 shadow-2xl backdrop-blur-xl sm:right-6 sm:bottom-6 {shaking
			? 'save-bar-shake border-zinc-500/80'
			: 'border-zinc-700/70'} {exiting ? 'save-bar-exit' : ''}"
	>
		<div class="flex items-center gap-2.5">
			{#if displaySaveStatus === "error"}
				<AlertTriangle class="h-4 w-4 text-zinc-300" strokeWidth={2} />
				<div>
					<p class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
						Error
					</p>
					<p class="text-sm text-zinc-300">{displaySaveError}</p>
				</div>
			{:else if displaySaveStatus === "success"}
				<Check class="h-4 w-4 text-zinc-100" strokeWidth={2.5} />
				<div>
					<p class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
						Saved
					</p>
					<p class="text-sm text-zinc-100">Settings saved successfully.</p>
				</div>
			{:else}
				<div>
					<p class="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
						Unsaved changes
					</p>
					<p class="text-sm font-medium text-zinc-300">{message}</p>
				</div>
			{/if}
		</div>
		<div class="flex items-center justify-end gap-2.5">
			{#if displayIsDirty && displaySaveStatus !== "saving"}
				<button
					type="button"
					onclick={onReset}
					class="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-sm font-medium text-zinc-300 transition-[background-color,border-color,color] hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
				>
					Reset
				</button>
			{/if}
			<button
				type="submit"
				form={formId}
				disabled={displaySaveStatus === "saving" || !displayIsDirty}
				class="rounded-lg bg-zinc-100 px-3.5 py-1.5 text-sm font-semibold text-zinc-900 transition-[background-color,opacity] hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if displaySaveStatus === "saving"}
					<span class="flex items-center gap-2">
						<Loader2 class="h-4 w-4 animate-spin" strokeWidth={2} />
						Saving…
					</span>
				{:else}
					Save changes
				{/if}
			</button>
		</div>
	</div>
{/if}

<style>
	.save-bar {
		animation: bar-enter 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	.save-bar-exit {
		animation: bar-exit 0.22s ease-in forwards;
	}

	.save-bar-shake {
		animation: bar-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
	}

	@media (max-width: 640px) {
		.save-bar {
			left: 0.75rem;
			right: 0.75rem;
			width: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.save-bar,
		.save-bar-exit,
		.save-bar-shake {
			animation: none !important;
			translate: 0 0;
		}
	}
</style>

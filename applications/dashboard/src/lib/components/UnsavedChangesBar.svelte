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
		class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
	>
		<div
			class="save-bar pointer-events-auto flex w-[min(calc(100vw-1.5rem),30rem)] flex-col gap-3 rounded-2xl border bg-zinc-900/96 px-4 py-3 shadow-2xl backdrop-blur-xl {shaking
				? 'save-bar-shake border-zinc-500/80'
				: 'border-zinc-700/70'} {exiting ? 'save-bar-exit' : ''}"
		>
			<div class="flex items-center gap-2.5">
				{#if displaySaveStatus === "error"}
					<AlertTriangle class="h-4 w-4 text-zinc-300" strokeWidth={2} />
					<div>
						<p
							class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase"
						>
							Error
						</p>
						<p class="text-sm text-zinc-300">{displaySaveError}</p>
					</div>
				{:else if displaySaveStatus === "success"}
					<Check class="h-4 w-4 text-zinc-100" strokeWidth={2.5} />
					<div>
						<p
							class="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase"
						>
							Saved
						</p>
						<p class="text-sm text-zinc-100">Settings saved successfully.</p>
					</div>
				{:else}
					<div>
						<p
							class="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
						>
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
	</div>
{/if}

<style>
	.save-bar {
		animation: save-bar-enter 0.28s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes save-bar-enter {
		from {
			opacity: 0;
			translate: 0 0.75rem;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	.save-bar-exit {
		animation: save-bar-exit 0.22s ease-in forwards;
	}

	@keyframes save-bar-exit {
		from {
			opacity: 1;
			translate: 0 0;
		}
		to {
			opacity: 0;
			translate: 0 0.75rem;
		}
	}

	.save-bar-shake {
		animation: save-bar-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
		background-color: rgb(24 24 27 / 0.96);
	}

	@keyframes save-bar-shake {
		0%,
		100% {
			translate: 0 0;
		}
		10%,
		30%,
		50%,
		70%,
		90% {
			translate: -4px 0;
		}
		20%,
		40%,
		60%,
		80% {
			translate: 4px 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.save-bar,
		.save-bar-exit,
		.save-bar-shake {
			animation: none !important;
		}

		.save-bar {
			translate: 0 0;
		}
	}
</style>

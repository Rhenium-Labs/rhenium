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

	$effect(() => {
		if (visible) {
			if (hideTimeout) {
				clearTimeout(hideTimeout);
				hideTimeout = undefined;
			}
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
		class="save-bar fixed right-0 bottom-6 left-64 z-50 mx-auto flex w-max items-center gap-5 rounded-xl border bg-zinc-900/95 px-5 py-3 shadow-2xl backdrop-blur-lg {shaking
			? 'save-bar-shake border-red-500/60'
			: 'border-zinc-700/50'} {exiting ? 'save-bar-exit' : ''}"
	>
		<div class="flex items-center gap-2.5">
			{#if saveStatus === "error"}
				<AlertTriangle class="h-4 w-4 text-red-400" strokeWidth={2} />
				<p class="text-sm text-red-400">{saveError}</p>
			{:else if saveStatus === "success"}
				<Check class="h-4 w-4 text-emerald-400" strokeWidth={2.5} />
				<p class="text-sm text-emerald-400">Settings saved successfully.</p>
			{:else}
				<p class="text-sm font-medium text-zinc-300">{message}</p>
			{/if}
		</div>
		<div class="flex items-center gap-3">
			{#if isDirty && saveStatus !== "saving"}
				<button
					type="button"
					onclick={onReset}
					class="rounded-lg border border-zinc-600 px-4 py-1.5 text-sm font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:bg-zinc-800"
				>
					Reset
				</button>
			{/if}
			<button
				type="submit"
				form={formId}
				disabled={saveStatus === "saving" || !isDirty}
				class="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if saveStatus === "saving"}
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
		animation: save-bar-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes save-bar-enter {
		from {
			opacity: 0;
			translate: 0 1rem;
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
		background-color: rgb(127 29 29 / 0.25);
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
</style>

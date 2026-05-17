<script lang="ts" module>
	export type SelectOption = {
		value: string;
		label: string;
		disabled?: boolean;
	};
</script>

<script lang="ts">
	import { ChevronDown } from "@lucide/svelte";

	let {
		value = $bindable(""),
		options,
		placeholder = "Select…",
		onchange,
		class: className = "",
		disabled = false
	}: {
		value?: string;
		options: SelectOption[];
		placeholder?: string;
		onchange?: (value: string) => void;
		class?: string;
		disabled?: boolean;
	} = $props();

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement | undefined>();
	let containerEl = $state<HTMLDivElement | undefined>();

	const selectedOption = $derived(options.find(o => !o.disabled && o.value === value));

	function pick(v: string) {
		value = v;
		onchange?.(v);
		open = false;
	}

	function handleWindowClick(e: MouseEvent) {
		if (open && containerEl && !containerEl.contains(e.target as Node)) {
			open = false;
		}
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && open) {
			open = false;
			triggerEl?.focus();
		}
	}
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="relative {className}" bind:this={containerEl}>
	<button
		bind:this={triggerEl}
		type="button"
		{disabled}
		onclick={() => (open = !open)}
		aria-haspopup="listbox"
		aria-expanded={open}
		class="flex w-full items-center justify-between gap-2 rounded-lg border bg-zinc-800 px-3 py-2 text-left text-sm transition-colors outline-none hover:border-zinc-600 focus-visible:shadow-[0_0_0_2px_rgb(63_63_70/0.4)] disabled:cursor-not-allowed disabled:opacity-50 {open
			? 'border-zinc-600'
			: 'border-zinc-700'}"
	>
		<span class="truncate {selectedOption ? 'text-white' : 'text-zinc-500'}">
			{selectedOption?.label ?? placeholder}
		</span>
		<ChevronDown
			class="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-150 {open
				? 'rotate-180'
				: ''}"
			strokeWidth={2}
		/>
	</button>

	{#if open}
		<div
			role="listbox"
			class="absolute top-full left-0 z-50 mt-1 min-w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/30"
		>
			<div class="max-h-52 overflow-y-auto py-1">
				{#each options as option}
					<button
						type="button"
						role="option"
						aria-selected={option.value === value}
						onclick={() => !option.disabled && pick(option.value)}
						class="flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors {option.value ===
						value
							? 'bg-zinc-800 text-white'
							: 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'} {option.disabled
							? 'pointer-events-none cursor-default italic opacity-40'
							: 'cursor-pointer'}"
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

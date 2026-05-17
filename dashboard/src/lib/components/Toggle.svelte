<script lang="ts">
	let {
		checked = false,
		onToggle,
		label = "",
		size = "default"
	}: {
		checked: boolean;
		onToggle: () => void;
		label?: string;
		size?: "default" | "lg";
	} = $props();

	const isLg = $derived(size === "lg");
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={onToggle}
	class="relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent ring-offset-zinc-950 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:ring-offset-2 focus-visible:outline-none {isLg
		? 'h-6 w-11'
		: 'h-5 w-9'} {checked ? 'bg-zinc-300' : 'bg-zinc-700'}"
>
	<span
		class="pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 {isLg
			? 'h-5 w-5'
			: 'h-4 w-4'} {checked
			? isLg
				? 'translate-x-5'
				: 'translate-x-4'
			: 'translate-x-0'}"
	></span>
</button>

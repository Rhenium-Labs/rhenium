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

	const trackClasses = $derived(size === "lg" ? "h-7 w-[3.25rem] p-0.5" : "h-6 w-10 p-0.5");

	const thumbClasses = $derived(
		size === "lg" ? "h-[1.2rem] w-[1.2rem] translate-x-0" : "h-4 w-4 translate-x-0"
	);

	const thumbCheckedClasses = $derived(
		size === "lg" ? "translate-x-[1.8rem]" : "translate-x-[1.25rem]"
	);
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={onToggle}
	class="inline-flex items-center rounded-full border transition-[background-color,border-color,box-shadow] duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-zinc-400/40 focus-visible:outline-none {trackClasses} {checked
		? 'border-zinc-500 bg-zinc-700'
		: 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'}"
>
	<span
		class="rounded-full bg-zinc-100 shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-[transform,background-color] duration-200 ease-in-out will-change-transform {thumbClasses} {checked
			? `${thumbCheckedClasses} bg-white`
			: ''}"
	></span>
</button>

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

	const sizeClasses = $derived(
		size === "lg"
			? "h-7 w-[3.25rem] after:h-6 after:w-6 peer-checked:after:translate-x-[1.25rem]"
			: "h-[1.375rem] w-10 after:h-[1.125rem] after:w-[1.125rem] peer-checked:after:translate-x-[1.125rem]"
	);
</script>

<label class="inline-flex cursor-pointer items-center gap-2">
	<input type="checkbox" {checked} onchange={onToggle} class="peer sr-only" />
	<div
		class="peer relative rounded-full border border-transparent bg-zinc-700 transition-colors duration-200 peer-checked:border-indigo-400/20 peer-checked:bg-indigo-500 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 after:absolute after:top-px after:left-0.5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:content-[''] {sizeClasses}"
		role="switch"
		aria-checked={checked}
		aria-label={label}
	></div>
</label>

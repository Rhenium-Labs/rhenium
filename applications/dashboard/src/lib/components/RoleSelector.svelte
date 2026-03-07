<script lang="ts">
	import { X } from "@lucide/svelte";
	import Select from "./Select.svelte";
	import type { SelectOption } from "./Select.svelte";

	interface RoleInfo {
		id: string;
		name: string;
		color: number;
		position: number;
		managed: boolean;
	}

	let {
		selected = $bindable([]),
		roles,
		placeholder = "Add a role\u2026",
		showHere = false,
		label = ""
	}: {
		selected: string[];
		roles: RoleInfo[];
		placeholder?: string;
		showHere?: boolean;
		label?: string;
	} = $props();

	function getRoleById(
		id: string
	): RoleInfo | { id: string; name: string; color: number } | undefined {
		if (id === "here") return { id: "here", name: "@here", color: 0 };
		return roles.find(r => r.id === id);
	}

	function roleColor(color: number): string {
		return color === 0 ? "#99aab5" : `#${color.toString(16).padStart(6, "0")}`;
	}

	function addRole(event: Event) {
		const target = event.target as HTMLSelectElement;
		const val = target.value;
		if (val && !selected.includes(val)) {
			selected = [...selected, val];
		}
		target.value = "";
	}
	function removeRole(roleId: string) {
		selected = selected.filter(r => r !== roleId);
	}

	const availableRoles = $derived(
		roles.filter((r: RoleInfo) => !r.managed && !selected.includes(r.id))
	);

	let addValue = $state("");

	const addOptions = $derived<SelectOption[]>([
		...(showHere && !selected.includes("here") ? [{ value: "here", label: "@here" }] : []),
		...availableRoles.map(r => ({ value: r.id, label: r.name }))
	]);

	function handleAdd(val: string) {
		if (val && !selected.includes(val)) {
			selected = [...selected, val];
		}
		addValue = "";
	}
</script>

<div>
	{#if label}
		<p class="text-sm font-medium text-zinc-300">{label}</p>
	{/if}

	{#if selected.length > 0}
		<div class="mt-2.5 flex flex-wrap gap-1.5">
			{#each selected as roleId (roleId)}
				{@const role = getRoleById(roleId)}
				<span
					class="item-enter inline-flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-200"
				>
					<span
						class="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm"
						style="background-color: {role ? roleColor(role.color) : '#99aab5'}"
					></span>
					{role?.name ?? `Unknown (${roleId})`}
					<button
						type="button"
						onclick={() => removeRole(roleId)}
						class="ml-0.5 rounded-sm p-0.5 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
						aria-label="Remove role"
					>
						<X class="h-3 w-3" strokeWidth={2.5} />
					</button>
				</span>
			{/each}
		</div>
	{/if}

	<Select
		bind:value={addValue}
		{placeholder}
		options={addOptions}
		onchange={handleAdd}
		class="mt-2 w-full max-w-sm"
	/>
</div>

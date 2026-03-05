<script lang="ts">
	import { X } from "@lucide/svelte";
	import { flip } from "svelte/animate";
	import { scale } from "svelte/transition";

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
					animate:flip={{ duration: 160 }}
					in:scale={{ duration: 140, start: 0.92 }}
					out:scale={{ duration: 100, start: 1 }}
					class="role-chip group inline-flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600/60 hover:bg-zinc-800"
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

	<select
		onchange={addRole}
		class="mt-2 w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-400 transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
	>
		<option value="">{placeholder}</option>
		{#if showHere && !selected.includes("here")}
			<option value="here">@here</option>
		{/if}
		{#each availableRoles as role (role.id)}
			<option value={role.id}>{role.name}</option>
		{/each}
	</select>
</div>

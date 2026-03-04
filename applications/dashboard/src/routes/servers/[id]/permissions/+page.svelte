<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { flip } from "svelte/animate";
	import { cubicOut } from "svelte/easing";
	import { fade, slide } from "svelte/transition";
	import { UserPermission } from "@repo/config";
	import { KeyRound, Plus, Trash2 } from "@lucide/svelte";
	import UnsavedChangesBar from "$lib/components/UnsavedChangesBar.svelte";
	import PageHeader from "$lib/components/PageHeader.svelte";
	import ConfigSection from "$lib/components/ConfigSection.svelte";
	import type { PageData } from "./$types";

	interface RoleInfo {
		id: string;
		name: string;
		managed: boolean;
	}

	type ScopeRow = {
		id: string;
		roleId: string;
		allowedPermissions: UserPermission[];
		roleLocked: boolean;
	};

	let { data }: { data: PageData } = $props();
	const config = $derived(data.guild.config.permission_scopes);
	const roles: RoleInfo[] = $derived(data.roles.filter((r: RoleInfo) => !r.managed));
	const allPermissions = Object.values(UserPermission);
	let nextScopeId = 0;

	let scopes = $state<ScopeRow[]>([]);

	function createScopeRow(
		roleId: string,
		allowedPermissions: UserPermission[],
		roleLocked: boolean
	): ScopeRow {
		return {
			id: `scope-${nextScopeId++}`,
			roleId,
			allowedPermissions: [...allowedPermissions],
			roleLocked
		};
	}

	$effect.pre(() => {
		scopes = data.guild.config.permission_scopes.map(scope =>
			createScopeRow(scope.role_id, scope.allowed_permissions, true)
		);
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;
	let scopeRowMeasureEl: HTMLDivElement | undefined;
	let reservedEmptyHeight = $state(0);

	function normalizeScopeRows(
		rows: Array<{ roleId: string; allowedPermissions: UserPermission[] }>
	) {
		return rows
			.map(({ roleId, allowedPermissions }) => ({
				roleId,
				allowedPermissions: [...allowedPermissions].sort((a, b) => a.localeCompare(b))
			}))
			.sort((a, b) => a.roleId.localeCompare(b.roleId));
	}

	const isDirty = $derived(
		JSON.stringify(normalizeScopeRows(scopes)) !==
			JSON.stringify(
				normalizeScopeRows(
					config.map(scope => ({
						roleId: scope.role_id,
						allowedPermissions: [...scope.allowed_permissions]
					}))
				)
			)
	);

	$effect(() => {
		if (!scopeRowMeasureEl) return;
		const measuredHeight = Math.ceil(scopeRowMeasureEl.getBoundingClientRect().height);
		if (measuredHeight > 0 && measuredHeight !== reservedEmptyHeight) {
			reservedEmptyHeight = measuredHeight;
		}
	});

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
		scopes = config.map(scope =>
			createScopeRow(scope.role_id, scope.allowed_permissions, true)
		);
	}

	function addScope() {
		const roleId = roles[0]?.id;
		if (!roleId) return;
		scopes = [...scopes, createScopeRow(roleId, [], false)];
	}

	function removeScope(scopeId: string) {
		scopes = scopes.filter(scope => scope.id !== scopeId);
	}

	function getRoleName(roleId: string): string {
		return roles.find(role => role.id === roleId)?.name ?? "Unknown role";
	}

	async function submitConfig(event: SubmitEvent) {
		event.preventDefault();
		if (saveStatus === "saving") return;

		saveStatus = "saving";
		saveError = "";
		try {
			const response = await fetch(`/api/servers/${data.guild.id}/configs/permissions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					scopes: scopes.map(({ roleId, allowedPermissions }) => ({
						roleId,
						allowedPermissions
					}))
				})
			});

			const payload = (await response.json()) as { success: boolean; error?: string };
			if (!response.ok || !payload.success)
				throw new Error(payload.error ?? "Failed to save permission scopes.");

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

<div class="space-y-8">
	<PageHeader
		title="Permissions"
		description="Control which roles can access specific moderation capabilities."
		icon={KeyRound}
	/>

	<form id="permissions-form" onsubmit={submitConfig} class="space-y-6">
		<ConfigSection
			title="Role Scopes"
			description="Map roles to the permissions they're allowed to use."
		>
			<div class="mb-4 flex justify-end">
				<button
					type="button"
					onclick={addScope}
					class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
				>
					<Plus class="h-3.5 w-3.5" strokeWidth={2} />
					Add scope
				</button>
			</div>

			<div
				class="relative space-y-4"
				style:min-height={scopes.length === 0 && reservedEmptyHeight > 0
					? `${reservedEmptyHeight}px`
					: undefined}
			>
				{#if scopes.length === 0}
					<p
						class="absolute inset-0 flex items-center justify-center text-sm text-zinc-600"
					>
						No scopes configured.
					</p>
				{/if}
				{#each scopes as scope (scope.id)}
					<div
						animate:flip={{ duration: 170, easing: cubicOut }}
						in:fade={{ duration: 120 }}
						out:slide={{ duration: 140, easing: cubicOut }}
						class="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"
					>
						<div class="flex items-center justify-between gap-3">
							{#if scope.roleLocked}
								<div
									class="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-300"
								>
									@<span class="font-medium text-white"
										>{getRoleName(scope.roleId)}</span
									>
								</div>
							{:else}
								<select
									bind:value={scope.roleId}
									class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white transition-colors outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
								>
									{#each roles as role}
										<option value={role.id}>{role.name}</option>
									{/each}
								</select>
							{/if}
							<button
								type="button"
								onclick={() => removeScope(scope.id)}
								class="inline-flex items-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/40"
							>
								<Trash2 class="h-3.5 w-3.5" strokeWidth={2} />
								Remove
							</button>
						</div>
						<div class="grid gap-x-4 gap-y-2 md:grid-cols-2">
							{#each allPermissions as permission}
								<label
									class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/50"
								>
									<input
										type="checkbox"
										checked={scope.allowedPermissions.includes(
											permission
										)}
										onchange={e => {
											const checked = (
												e.target as HTMLInputElement
											).checked;
											scope.allowedPermissions = checked
												? [
														...scope.allowedPermissions,
														permission
													]
												: scope.allowedPermissions.filter(
														item => item !== permission
													);
											scopes = [...scopes];
										}}
										class="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500/30 focus:ring-offset-0"
									/>
									{permission}
								</label>
							{/each}
						</div>
					</div>
				{/each}

				<div
					bind:this={scopeRowMeasureEl}
					aria-hidden="true"
					class="pointer-events-none invisible absolute inset-x-0 top-0 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4"
				>
					<div class="flex items-center justify-between gap-3">
						<div
							class="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-300"
						>
							@<span class="font-medium text-white">placeholder</span>
						</div>
						<button
							type="button"
							class="inline-flex items-center gap-1.5 rounded-lg border border-red-900/50 px-3 py-2 text-sm text-red-400"
						>
							<Trash2 class="h-3.5 w-3.5" strokeWidth={2} />
							Remove
						</button>
					</div>
					<div class="grid gap-x-4 gap-y-2 md:grid-cols-2">
						{#each allPermissions as permission}
							<label
								class="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-300"
							>
								<input
									type="checkbox"
									class="h-4 w-4 rounded border-zinc-600 bg-zinc-800"
								/>
								{permission}
							</label>
						{/each}
					</div>
				</div>
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
	formId="permissions-form"
/>

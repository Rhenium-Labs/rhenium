<script lang="ts">
	import { beforeNavigate, invalidateAll } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { flip } from "svelte/animate";
	import { fade } from "svelte/transition";
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
		roleId: string;
		allowedPermissions: UserPermission[];
		roleLocked: boolean;
	};

	let { data }: { data: PageData } = $props();
	const config = $derived(data.guild.config.permission_scopes);
	const roles: RoleInfo[] = $derived(data.roles.filter((r: RoleInfo) => !r.managed));
	const allPermissions = Object.values(UserPermission);

	let scopes = $state<ScopeRow[]>([]);

	$effect.pre(() => {
		scopes = data.guild.config.permission_scopes.map(scope => ({
			roleId: scope.role_id,
			allowedPermissions: [...scope.allowed_permissions],
			roleLocked: true
		}));
	});

	let saveStatus = $state<"idle" | "saving" | "success" | "error">("idle");
	let saveError = $state("");
	let shaking = $state(false);
	let shakeTimeout: ReturnType<typeof setTimeout> | undefined;
	let statusTimeout: ReturnType<typeof setTimeout> | undefined;

	const isDirty = $derived(
		JSON.stringify(
			scopes.map(({ roleId, allowedPermissions }) => ({ roleId, allowedPermissions }))
		) !==
			JSON.stringify(
				config.map(scope => ({
					roleId: scope.role_id,
					allowedPermissions: [...scope.allowed_permissions]
				}))
			)
	);

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
		scopes = config.map(scope => ({
			roleId: scope.role_id,
			allowedPermissions: [...scope.allowed_permissions],
			roleLocked: true
		}));
	}

	function addScope() {
		const roleId = roles[0]?.id;
		if (!roleId) return;
		scopes = [...scopes, { roleId, allowedPermissions: [], roleLocked: false }];
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

			<div class="space-y-4">
				{#if scopes.length === 0}
					<p class="py-4 text-center text-sm text-zinc-600">No scopes configured.</p>
				{/if}
				{#each scopes as scope, index (scope)}
					<div
						animate:flip={{ duration: 180 }}
						in:fade={{ duration: 140 }}
						out:fade={{ duration: 110 }}
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
								onclick={() =>
									(scopes = scopes.filter((_, i) => i !== index))}
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

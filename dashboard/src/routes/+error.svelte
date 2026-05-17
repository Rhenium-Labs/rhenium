<script lang="ts">
	import { page } from "$app/stores";
	import { Frown, Lock, AlertTriangle, ArrowLeft, Home } from "@lucide/svelte";

	const errorMessages: Record<number, { title: string; fallback: string }> = {
		400: { title: "Bad Request", fallback: "The request was invalid or malformed." },
		401: { title: "Unauthorized", fallback: "You need to log in to access this page." },
		403: {
			title: "Access Denied",
			fallback: "You don't have permission to access this resource."
		},
		404: { title: "Not Found", fallback: "The page you're looking for doesn't exist." },
		500: { title: "Server Error", fallback: "Something went wrong on our end." }
	};

	const status = $derived($page.status);
	const error = $derived($page.error);
	const errorInfo = $derived(
		errorMessages[status] ?? { title: "Error", fallback: "An unexpected error occurred." }
	);
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-4 text-center">
	<!-- Error Icon -->
	<div class="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-red-500/10">
		{#if status === 404}
			<Frown class="h-10 w-10 text-red-400" />
		{:else if status === 403}
			<Lock class="h-10 w-10 text-red-400" />
		{:else}
			<AlertTriangle class="h-10 w-10 text-red-400" />
		{/if}
	</div>

	<!-- Error Code -->
	<div class="mb-2 text-sm font-medium text-red-400">
		Error {status}
	</div>

	<!-- Error Title -->
	<h1 class="mb-3 text-2xl font-bold text-white">
		{error?.message ?? errorInfo.title}
	</h1>

	<!-- Error Description -->
	<p class="mb-8 max-w-md text-zinc-400">
		{error?.description ?? errorInfo.fallback}
	</p>

	<!-- Actions -->
	<div class="flex gap-3">
		<a
			href="/servers"
			class="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
		>
			<ArrowLeft class="h-4 w-4" />
			Go to Servers
		</a>
		<a
			href="/"
			class="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
		>
			<Home class="h-4 w-4" />
			Back to Home
		</a>
	</div>
</div>

<script lang="ts">
	import { page } from "$app/stores";

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
			<svg
				class="h-10 w-10 text-red-400"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
		{:else if status === 403}
			<svg
				class="h-10 w-10 text-red-400"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
				/>
			</svg>
		{:else}
			<svg
				class="h-10 w-10 text-red-400"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/>
			</svg>
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
			class="rounded-lg bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
		>
			Go to Servers
		</a>
		<a
			href="/"
			class="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
		>
			Back to Home
		</a>
	</div>
</div>

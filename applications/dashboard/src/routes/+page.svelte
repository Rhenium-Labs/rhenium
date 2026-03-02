<div class="flex min-h-screen flex-col items-center justify-center px-4 text-center">
	<div class="hero-logo">
		<img
			src="/rhenium/Rhenium.png"
			alt="Rhenium"
			class="mb-4 h-24 w-24 rounded-2xl shadow-lg"
		/>
	</div>

	<p class="hero-subtitle mt-4 max-w-md text-lg text-zinc-400">
		Welcome to Rhenium's dashboard. Login with Discord to view and manage your server configs.
	</p>

	<div class="hero-button">
		<a
			href="/api/auth/discord"
			class="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#4752C4] active:scale-[0.98]"
		>
			<svg class="h-5 w-5" viewBox="0 0 127.14 96.36" fill="currentColor">
				<path
					d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2.03a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2.03a68.68 68.68 0 0 1-10.87 5.19 77.3 77.3 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53.05s5-12.68 11.45-12.68S54 46.09 53.89 53.05 48.84 65.69 42.45 65.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53.05s5-12.68 11.44-12.68S96.23 46.09 96.12 53.05 91.08 65.69 84.69 65.69Z"
				/></svg
			>
			Login with Discord
		</a>
	</div>
</div>

<style>
	.hero-logo {
		animation: logo-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
		will-change: transform, filter, opacity;
	}

	.hero-subtitle {
		animation: fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.45s both;
		will-change: transform, filter, opacity;
	}

	.hero-button {
		animation: fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.6s both;
		will-change: transform, filter, opacity;
	}

	@keyframes logo-in {
		0% {
			opacity: 0;
			transform: scale(1.4) translateY(80px);
			filter: blur(12px);
		}
		100% {
			opacity: 1;
			transform: none;
			filter: blur(0);
		}
	}

	@keyframes fade-up {
		0% {
			opacity: 0;
			transform: translateY(24px);
			filter: blur(6px);
		}
		100% {
			opacity: 1;
			transform: none;
			filter: blur(0);
		}
	}
</style>

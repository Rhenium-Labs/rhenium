<script lang="ts">
	import "./layout.css";

	const siteName = "Rhenium";
	const defaultTitle = "Rhenium Dashboard";
	const defaultDescription = "Dashboard for managing Rhenium configs.";
	const defaultUrl = "https://dashboard.rhenium.app";
	const ogImage = `${defaultUrl}/rhenium/Banner.png`;

	let { children } = $props();
</script>

<svelte:head>
	<!-- Favicon -->
	<link rel="icon" type="image/x-icon" href="/rhenium/Favicon.ico" />
	<link rel="apple-touch-icon" href="/rhenium/Rhenium.png" />

	<!-- Primary Meta Tags -->
	<title>{defaultTitle}</title>
	<meta name="title" content={defaultTitle} />
	<meta name="description" content={defaultDescription} />
	<meta name="robots" content="index, follow" />

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:url" content={defaultUrl} />
	<meta property="og:site_name" content={siteName} />
	<meta property="og:title" content={defaultTitle} />
	<meta property="og:description" content={defaultDescription} />
	<meta property="og:image" content={ogImage} />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:url" content={defaultUrl} />
	<meta name="twitter:title" content={defaultTitle} />
	<meta name="twitter:description" content={defaultDescription} />

	<meta name="twitter:image" content={ogImage} />
</svelte:head>

{@render children()}

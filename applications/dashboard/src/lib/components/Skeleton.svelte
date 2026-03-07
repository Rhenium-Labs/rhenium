<script lang="ts">
	let {
		class: className = "",
		style = ""
	}: {
		class?: string;
		style?: string;
	} = $props();
</script>

<div class="skeleton {className}" {style} aria-hidden="true"></div>

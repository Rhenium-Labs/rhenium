import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		external: ["kysely"]
	},
	build: {
		rollupOptions: {
			onwarn(warning, warn) {
				if (
					warning.code === "CIRCULAR_DEPENDENCY" &&
					typeof warning.message === "string" &&
					warning.message.includes("kysely")
				) {
					return;
				}

				warn(warning);
			}
		}
	}
});

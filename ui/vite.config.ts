import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build the Workflows Companion to ONE self-contained HTML (Path B). A single
// input + `inlineDynamicImports` is the locked recipe for `vite-plugin-singlefile`:
// it inlines ALL JS + CSS (incl. the Tailwind-compiled utilities + React Flow's
// base.css) into the HTML so the emitted document has ZERO external fetches —
// required under the companion CSP `connect-src 'none'`. Tailwind is compiled at
// build time via `@tailwindcss/postcss` (see postcss.config.mjs), scanning ONLY
// this package's own src (`@source` in tailwind.css) with a self-contained token
// block copied from the design system — so classNames survive without importing
// the repo-wide design-system globals. The output is `dist/index.html`, shipped
// verbatim as the plugin's `ui_code`.

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: here,
	base: "./",
	plugins: [react(), viteSingleFile()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "esnext",
		cssCodeSplit: false,
		assetsInlineLimit: Number.POSITIVE_INFINITY,
		modulePreload: { polyfill: false },
		rollupOptions: {
			input: { workflows: resolve(here, "index.html") },
			output: { inlineDynamicImports: true },
		},
	},
});

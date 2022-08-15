import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['./tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
		reporters: ['verbose'],
		coverage: {
			reporter: ['text'],
			clean: true,
		},
	},
});

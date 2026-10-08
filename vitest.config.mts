import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['./tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
		reporters: ['default'],
		coverage: {
			include: ['src/**/*.ts'],
			reporter: ['text'],
			clean: true,
		},
	},
});

import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [{
	files: ['src/**/*.ts', 'tests/**/*.ts'],
	languageOptions: { parser },
	plugins: { '@typescript-eslint': plugin },
	rules: {
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		'quotes': ['error', 'single'],
		'semi': ['error', 'always'],
	},
}];

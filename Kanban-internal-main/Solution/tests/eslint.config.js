import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/test-results/**',
      '**/test-results-smoke/**',
      '**/playwright-report/**',
      'node_modules/**',
    ],
  },
  ...tseslint.configs.recommended,
);

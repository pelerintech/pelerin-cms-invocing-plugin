// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      'prefer-const': 'warn',
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.astro/',
      'coverage/',
      'reespec/',
      'test-results/',
      'tests/',
    ],
  }
);

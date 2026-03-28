import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-regex-spaces': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.*'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.*'],
  },
);

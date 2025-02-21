import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'

export default [
  ...oclif.map(config => ({
    ...config,
    rules: {
      ...config.rules,
      // Disable some strict rules that aren't auto-fixable
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'complexity': 'off',
      'max-depth': 'off',
      'no-undef': 'warn',
    },
  })),
  prettier,
  {
    ignores: ['dist/*', 'node_modules/*'],
  },
] 
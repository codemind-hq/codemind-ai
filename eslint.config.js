import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'examples/**/*.js', 'eval/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['src/**/*.test.js', 'examples/**/*.js', 'eval/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    // The package stands alone: it never reaches into the apps that use it.
    files: ['src/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/apps/**', '../../../*', '../../../../*'], message: '@codemind/ai never imports the app around it; take what it needs through createCodemind().' }] }],
    },
  },
];

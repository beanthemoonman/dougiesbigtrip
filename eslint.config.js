// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // sim/pkg is wasm-pack generated output; not our code to lint.
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'sim/pkg/**', 'target/**'],
  },
  {
    // Node tool scripts (build helpers, config): give them node globals.
    files: ['tools/**', '**/*.mjs', '*.config.{js,ts}', 'tests/**'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', __filename: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Non-null assertions are used deliberately for DOM lookups and buffer
      // access; the hard ban is on `any`, not this. ponytail: turn back on if
      // it starts hiding real null bugs.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);

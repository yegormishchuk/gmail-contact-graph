import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // Never lint build output or dependencies.
  { ignores: ['**/dist/**', '**/node_modules/**'] },

  js.configs.recommended,
  // Non-type-checked preset on purpose: the type-aware variant is far slower
  // and noisier. Graduating to it is a separate decision.
  ...tseslint.configs.recommended,

  {
    // Existing codebase convention: destructured elements (esp. `[_, value]`
    // array patterns) and args that are intentionally unused are named `_`.
    // Honor that convention instead of forcing deletions/renames.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['packages/server/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['packages/client/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks v5+ folded the React Compiler's lint rules into
      // "recommended". This codebase predates React Compiler adoption, and the
      // patterns these four rules flag — ref writes during render, the manual
      // useCallback memoization boundaries in useD3Simulation.ts, and resetting
      // component state from an effect — are deliberate here, not bugs. Turn
      // them off for now; re-enable if/when this codebase adopts React Compiler.
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
);

import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';

// tech-stack §6: these fences are what the API-boundary reviewer greps for.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      import: importPlugin,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules, // React 19 automatic JSX runtime -- no `import React` needed
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react/jsx-no-literals': 'error', // NFR-036 — every user-facing string goes through i18n/t()
      // A horizontally scrolling table wrapper must be keyboard-reachable (axe
      // scrollable-region-focusable); role="region" + tabIndex=0 is the documented pattern.
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: ['main'], roles: ['tabpanel', 'region'] },
      ],
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src',
              from: '../backend',
              message: 'Frontend must not import backend code (no business logic in the frontend).',
            },
          ],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'dayjs',
              message: 'No date-arithmetic libraries in the frontend — display-only format.ts.',
            },
            {
              name: 'moment',
              message: 'No date-arithmetic libraries in the frontend — display-only format.ts.',
            },
            { name: 'lodash', message: 'No numeric/date utility libraries in the frontend.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No dangerouslySetInnerHTML.',
        },
        { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
      ],
    },
    settings: { react: { version: '19' } },
  },
);

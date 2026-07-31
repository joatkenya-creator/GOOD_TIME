import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'src/generated/**', 'coverage/**', 'next-env.d.ts'],
  },

  ...coreWebVitals,
  ...nextTypescript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  {
    /**
     * Import boundary: client-side code must never *run* server-only modules.
     *
     * `allowTypeImports` is deliberate. A `import type { Foo }` is erased at
     * compile time and pulls nothing into the bundle, so a server component
     * sharing its return type with a presentational component is correct and
     * desirable — it is what keeps the two in sync. Only value imports would
     * drag Prisma into the browser.
     */
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/providers/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/*', '@/services/*', '@/lib/prisma'],
              allowTypeImports: true,
              message:
                'Server-only module. Import only its types, or reach it through a server action or route handler.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['prisma/**/*.ts', 'scripts/**/*.{ts,cjs,mjs}', '*.config.{ts,mjs}'],
    rules: {
      'no-console': 'off',
      // Maintenance scripts run under plain Node, outside the bundler.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default config;

import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    /**
     * Build artefacts and generated code.
     *
     * `.open-next/` matters more than it looks: it contains a traced copy of
     * `node_modules`, so leaving it unignored makes `npm run lint` walk tens of
     * thousands of third-party files and report hundreds of errors in code
     * nobody here wrote. It only exists after `cf:build`, which is why the
     * problem appears the first time somebody builds for Cloudflare.
     */
    ignores: [
      '.next/**',
      '.open-next/**',
      '.wrangler/**',
      'node_modules/**',
      'src/generated/**',
      'coverage/**',
      '.playwright/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
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
     *
     * `@/server/actions/*` is exempt. A `'use server'` module imported by a
     * client component is compiled to a fetch call, not bundled — that is the
     * sanctioned way for client code to reach the server, and banning it would
     * leave no way to mutate anything from a form.
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
              group: [
                '@/server/*',
                '!@/server/actions',
                '!@/server/actions/*',
                '@/services/*',
                '@/lib/prisma',
              ],
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

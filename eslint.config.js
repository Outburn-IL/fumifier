import js from '@eslint/js';
import promise from 'eslint-plugin-promise';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

// Shared rules for both src and test files
const sharedRules = {
  // Promise plugin recommended rules
  ...promise.configs.recommended.rules,

  // Custom rules
  'array-bracket-spacing': ['error', 'never'],
  'brace-style': ['error', '1tbs', { allowSingleLine: true }],
  'dot-notation': 'error',
  'eqeqeq': 'error',
  'no-tabs': 'error', // Replaces ideal/no-tabs-in-file
  'indent': ['error', 2, { SwitchCase: 1 }],
  'max-len': ['error', 1000, { ignoreComments: true }],
  'new-cap': ['error', { capIsNewExceptions: ['Router'] }],
  'no-console': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-floating-decimal': 'error',
  'no-lonely-if': 'error',
  'func-call-spacing': 'error', // Replaces deprecated no-spaced-func
  'no-throw-literal': 'off',
  'no-trailing-spaces': 'error',
  'no-use-before-define': ['error', { functions: false }],
  'no-useless-call': 'error',
  'no-with': 'error',
  'no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none', // Allow unused error in catch blocks
  }],
  'operator-linebreak': ['error', 'after'],
  'semi': ['error', 'always'],

  // JSDoc rules (replacing removed require-jsdoc and valid-jsdoc)
  'jsdoc/require-jsdoc': ['error', {
    require: {
      ClassDeclaration: true,
      MethodDefinition: true,
      FunctionDeclaration: true,
    },
  }],
  'jsdoc/require-param-description': 'off',
  'jsdoc/require-returns-description': 'off',
  'jsdoc/require-returns': 'off',
};

// Shared plugins
const sharedPlugins = {
  promise,
  jsdoc,
};

// Shared language options
const sharedLanguageOptions = {
  ecmaVersion: 2022,
  sourceType: 'module',
  globals: {
    ...globals.node,
    ...globals.mocha,
    ...globals.es2021,
    ...globals.browser,
  },
};

export default [
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      'coverage/**',
      'node_modules/**',
      'dist/**',
      'doc/**',
      'fumifier.js',
      'fumifier-es5.js',
      '**/*.min.js',
    ],
  },

  // Base configuration for all JS files
  js.configs.recommended,

  // Main source configuration
  {
    files: ['src/**/*.js'],
    plugins: sharedPlugins,
    languageOptions: sharedLanguageOptions,
    rules: {
      ...sharedRules,
      'strict': ['error', 'function'],
    },
  },

  // Test files configuration (overrides strict rule)
  {
    files: ['test/**/*.js'],
    plugins: sharedPlugins,
    languageOptions: sharedLanguageOptions,
    rules: {
      ...sharedRules,
      'jsdoc/require-jsdoc': 'off',
      'strict': ['error', 'global'], // Override: global instead of function
    },
  },
];

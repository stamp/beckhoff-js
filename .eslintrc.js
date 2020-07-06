module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'airbnb-typescript/base',
    'prettier',
    'prettier/@typescript-eslint',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    "indent": ["error", 2],
    'quotes': ["error", "single"],
    'import/prefer-default-export': 'off',
    'max-classes-per-file': 'off',
    'class-methods-use-this': 'off',
    'no-console': ["error", { "allow": ["warn", "error"] }],
    '@typescript-eslint/no-unused-vars': 'warn',
    "@typescript-eslint/semi": ["error"],
    'quote-props': ["error", "as-needed"]
  },
};

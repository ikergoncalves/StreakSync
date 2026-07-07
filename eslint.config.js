const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // landing-page/ is an isolated Vite project with its own tooling
    ignores: ['dist/*', 'coverage/*', '.expo/*', 'landing-page/*'],
  },
]);

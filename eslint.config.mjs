import globals from "globals";
import json from "eslint-plugin-json";
import mozilla from "eslint-plugin-mozilla";
import pluginJest from "eslint-plugin-jest";

export default [
  {
    ignores: [
      "node_modules/",
      "web-ext-artifacts/",
      "extension/content/*.min.js",
      "**/*.html",
    ],
  },
  {
    languageOptions: {
      globals: {
        ...globals.es2024,
      },
    },
  },
  ...mozilla.configs["flat/recommended"],
  {
    files: ["**/*.json"],
    plugins: { json },
    processor: json.processors[".json"],
    rules: json.configs.recommended.rules,
  },
  {
    files: ["extension/**"],
    languageOptions: {
      globals: {
        ...globals.webextensions,
      },
    },
  },
  {
    files: ["extension/content/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["extension/experiments/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...mozilla.environments.privileged.globals,
      },
    },
  },
  {
    files: [
      "tests/*.spec.js",
    ],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
        ...pluginJest.environments.globals.globals,
      },
    },
  },
  {
    files: [
      ".prettierrc.js",
    ],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.node,
      },
    },
  },
];
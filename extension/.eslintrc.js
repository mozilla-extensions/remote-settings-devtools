/* eslint-env node */
module.exports = {
  env: {
    webextensions: true,
  },
  rules: {
    "no-console": [
      "error",
      {
        allow: ["error", "warn"],
      },
    ],
  },
};

/* eslint-env node */
module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:prettier/recommended",
    "plugin:mozilla/recommended",
  ],
  rules: {
    "mozilla/no-define-cc-etc": "off", // seems broken outside of m-c
  },
};
